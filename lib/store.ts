import fs from "fs";
import path from "path";
import { SLUG_DEFAULT } from "./competencias";

/**
 * Persistencia de las sesiones de pitch.
 *
 * El problema original: la API escribía `data/sessions.json` con fs.writeFileSync
 * sobre process.cwd(). En Vercel el filesystem es de solo lectura fuera de /tmp,
 * y aunque se pudiera escribir, cada invocación puede caer en otra instancia
 * (lambda distinta o cold start), así que el historial se perdía o aparecía
 * intermitente en la pantalla pública.
 *
 * Solución: dos backends detrás de la misma interfaz.
 *
 *   1. KV por REST (Vercel KV / Upstash Redis) si están las env vars.
 *      Es el único que persiste de verdad entre invocaciones en producción.
 *   2. Filesystem, para desarrollo local. En Vercel escribe en /tmp, que al
 *      menos sobrevive dentro de la misma instancia tibia en vez de tirar EROFS.
 *
 * `isDurable()` expone cuál está activo para que la UI pueda avisarlo.
 *
 * ## Limitación conocida: no hay escritura atómica
 *
 * Cada POST hace leer-modificar-escribir sobre el objeto entero. Dos requests
 * que se pisan —un chunk de transcripción y el sync de cada 12s, que es el
 * único cruce que ocurre seguido— terminan con el último que escribe pisando
 * al otro.
 *
 * No se arregló a propósito, porque el diseño de arriba lo absorbe: el sync
 * reenvía el texto completo, las métricas, las preguntas y las marcas cada 12
 * segundos, así que cualquier escritura perdida vuelve sola en el ciclo
 * siguiente. Lo peor que pasa es que un dato quede desactualizado unos
 * segundos.
 *
 * Con la separación por competición, dos operadores trabajando en
 * competiciones distintas ya no se pisan: cada uno escribe su propia clave.
 * Lo que sigue sin estar resuelto es DOS OPERADORES SOBRE LA MISMA
 * competición al mismo tiempo; para eso hay que pasar a escrituras atómicas
 * (JSON.SET de Redis o un script Lua) en vez de guardar el blob completo.
 */

export interface TeamSession {
  team: string;
  project: string;
  transcript: string;
  analysis?: string;
  /** Motivo por el que no se pudo generar la ficha, si falló. */
  analysisError?: string;
  /** Cuántas veces alcanzó a medir el LLM durante el pitch. */
  lecturas?: number;
  /**
   * Preguntas de cierre que la IA fue armando durante el pitch.
   *
   * Las genera /api/highlights desde el copiloto y viajan acá sólo para que
   * el home las pueda leer: la vista AI Judge no llama nunca al modelo, lee
   * esta lista ya calculada. Así ningún visitante puede gastar tokens.
   */
  preguntas?: string[];
  /**
   * Marcas del transcript: qué tramos son evidencia dura, cuáles demo en vivo
   * y cuáles afirmaciones sin respaldo.
   *
   * Se guardan las tres, pero el home muestra sólo "dato" y "demo": ver el
   * comentario en public/index.html sobre por qué "flojo" no va a una pantalla
   * pública mientras la persona está en el escenario.
   */
  marcas?: { cita: string; tipo: string }[];
  metrics?: Record<string, number>;
  isFinished: boolean;
  timestamp: string;
  updatedAt: number;
}

export interface SessionsData {
  sessions: Record<string, TeamSession>;
  activeTeam: string | null;
}

/**
 * Estado vacío, SIEMPRE recién construido.
 *
 * Antes era un objeto de módulo del que se devolvía una copia con spread. Ese
 * spread es superficial: copia `activeTeam` pero comparte el MISMO objeto
 * `sessions`. Con una sola competición no se notaba. Con dos es una fuga
 * directa: la primera guarda un pitch, muta ese objeto compartido, y la
 * segunda —que arranca vacía y recibe la misma referencia— abre el día
 * mostrando los equipos de la otra competición.
 */
function vacio(): SessionsData {
  return { sessions: {}, activeTeam: null };
}

/**
 * Una clave por competición.
 *
 * Antes era la constante "eday:sessions", global. Con dos competiciones eso
 * significa un solo `activeTeam` y un solo historial compartido: la segunda
 * competición del día le pisaba las fichas a la primera, y a la noche quedaba
 * una sola lista mezclada en vez de las dos completas.
 */
function kvKey(slug: string): string {
  return `eday:sessions:${slug}`;
}

/**
 * La clave de cuando había una sola competición.
 *
 * Todo lo que se grabó antes de la separación vive acá. Al pasar a una clave
 * por competición, esas fichas no se borraron pero quedaron inalcanzables: el
 * dashboard de la StartUp Competition empezó a leer una clave nueva y vacía
 * mientras el historial real seguía intacto dos centímetros al lado.
 *
 * Sólo la PRIMERA competición del registro hereda esto — es la única que
 * existía cuando la clave era global. AI Unified Commerce nunca la mira: si lo
 * hiciera, abriría el día con los equipos de la otra.
 */
const KV_KEY_LEGADO = "eday:sessions";

/**
 * Marca de que esta competición ya tiene estado propio.
 *
 * Existe por un bug que hacía imposible borrar. La migración del legado se
 * disparaba con "la clave nueva no tiene sesiones", usando el vacío como
 * sinónimo de "todavía no migré". Pero un vacío también es el resultado de que
 * el operador apriete «Borrar todas»: se guardaba la lista vacía y la lectura
 * siguiente la leía como "nunca migré" y volvía a copiar el historial viejo
 * encima. Borrar de a uno tenía el mismo final: andaba hasta el último equipo,
 * y al borrar ése —el que dejaba la clave vacía— reaparecían todos.
 *
 * El marcador separa las dos cosas que el vacío confundía: "no hay nada
 * todavía" y "no hay nada porque lo borraron". Se pone al migrar y al guardar
 * un vacío, y desde entonces el legado no se vuelve a mirar.
 */
function kvKeyMigrado(slug: string): string {
  return `eday:migrado:${slug}`;
}

/** Sólo la primera del registro heredó la clave global; es la única que puede migrar. */
function heredaElLegado(slug: string): boolean {
  return slug === SLUG_DEFAULT;
}

const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export function isDurable(): boolean {
  return Boolean(KV_URL && KV_TOKEN);
}

/**
 * De dónde salió la última lectura, que NO es lo mismo que `isDurable()`.
 *
 * `isDurable()` mira las variables de entorno: dice si hay una base
 * configurada. No dice si esa base contestó. Cuando Redis falla, `loadSessions`
 * cae al filesystem —que en Vercel es /tmp, distinto en cada instancia— y
 * devuelve una lista que puede estar incompleta o vacía, con `isDurable()`
 * diciendo `true` igual.
 *
 * Esa diferencia importa para quien use la lista del servidor para BORRAR algo
 * suyo: la pantalla de sala poda su historial local con lo que el servidor no
 * tiene, y hacerlo contra una lectura de /tmp sería tirar la única copia buena
 * por un parpadeo de la base. Sólo se puede podar cuando esto dice "kv".
 */
export type Fuente = "kv" | "fs";
let ultimaFuente: Fuente = "fs";
export function fuenteUltimaLectura(): Fuente {
  return ultimaFuente;
}

/** En Vercel el único directorio escribible es /tmp. Un archivo por competición. */
function fsFile(slug: string): string {
  const dir = process.env.VERCEL ? "/tmp/eday-data" : path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `sessions-${slug.replace(/[^a-z0-9-]/gi, "_")}.json`);
}

async function kvGetClave(clave: string): Promise<SessionsData> {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(clave)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV GET ${res.status}`);
  const body = await res.json();
  // Upstash devuelve { result: "<string>" | null }
  if (!body || body.result == null) return vacio();
  const raw = typeof body.result === "string" ? body.result : JSON.stringify(body.result);
  const parsed = JSON.parse(raw);
  return {
    sessions: parsed.sessions || {},
    activeTeam: parsed.activeTeam ?? null,
  };
}

async function kvSetClave(clave: string, data: SessionsData): Promise<void> {
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(clave)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV SET ${res.status}`);
}

/**
 * ¿Esta competición ya tiene estado propio?
 *
 * Si la consulta falla se responde `true`, o sea "no migres". Migrar de más
 * resucita fichas que el operador borró, en vivo y sin manera de volver a
 * borrarlas hasta el próximo deploy. Migrar de menos deja el historial viejo
 * quieto donde está, y la próxima lectura que sí conteste lo trae. Entre las
 * dos formas de equivocarse, ésta se arregla sola.
 */
async function yaTieneEstadoPropio(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(kvKeyMigrado(slug))}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) return true;
    const body = await res.json();
    return body?.result != null;
  } catch {
    return true;
  }
}

/** Deja la marca. Si falla, no se cae nada: lo peor es que se revise de nuevo. */
async function marcarEstadoPropio(slug: string): Promise<void> {
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(kvKeyMigrado(slug))}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ migrado: new Date().toISOString() }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[store] No se pudo marcar la migración:", e);
  }
}

export async function loadSessions(slug: string): Promise<SessionsData> {
  if (isDurable()) {
    try {
      let data = await kvGetClave(kvKey(slug));

      /**
       * Rescate de lo grabado antes de que hubiera competiciones.
       *
       * Se lee la clave global vieja y se copia a la nueva. Pasa UNA sola vez,
       * y quien decide eso es el marcador, no el hecho de que la lista esté
       * vacía: una lista vacía puede ser "todavía no hay nada" o "el operador
       * borró todo", y tratarlas igual era exactamente lo que hacía que borrar
       * no sirviera para nada.
       *
       * La clave vieja NO se borra. Es el respaldo de un historial que no se
       * puede volver a grabar, y no ocupa nada. Simplemente deja de mirarse.
       */
      if (
        !Object.keys(data.sessions).length &&
        heredaElLegado(slug) &&
        !(await yaTieneEstadoPropio(slug))
      ) {
        const legado = await kvGetClave(KV_KEY_LEGADO);
        if (Object.keys(legado.sessions).length) {
          console.log(
            `[store] Migrando ${Object.keys(legado.sessions).length} sesión(es) de ${KV_KEY_LEGADO} a ${kvKey(slug)}`
          );
          await kvSetClave(kvKey(slug), legado);
          data = legado;
        }
        // Se marca haya habido algo que copiar o no: la pregunta que contesta
        // el marcador es "¿ya revisé el legado?", y la respuesta ya es sí.
        await marcarEstadoPropio(slug);
      }

      ultimaFuente = "kv";
      return data;
    } catch (e) {
      console.error("[store] Falló la lectura de KV, uso filesystem:", e);
    }
  }
  ultimaFuente = "fs";
  try {
    let file = fsFile(slug);
    // El archivo de cuando no había competiciones, para desarrollo local.
    if (!fs.existsSync(file) && slug === SLUG_DEFAULT) {
      const legado = path.join(path.dirname(file), "sessions.json");
      if (fs.existsSync(legado)) file = legado;
    }
    if (!fs.existsSync(file)) return vacio();
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return { sessions: parsed.sessions || {}, activeTeam: parsed.activeTeam ?? null };
  } catch {
    return vacio();
  }
}

export async function saveSessions(slug: string, data: SessionsData): Promise<void> {
  if (isDurable()) {
    try {
      await kvSetClave(kvKey(slug), data);
      /**
       * Guardar una lista vacía es una decisión, no una ausencia.
       *
       * Es el estado en el que queda la base cuando el operador borra todo, o
       * cuando borra el último equipo que quedaba. Sin dejar constancia, la
       * lectura siguiente lo lee como "acá nunca hubo nada" y devuelve el
       * historial viejo, y el borrado no se puede completar nunca.
       */
      if (!Object.keys(data.sessions).length && heredaElLegado(slug)) {
        await marcarEstadoPropio(slug);
      }
      return;
    } catch (e) {
      console.error("[store] Falló la escritura en KV, uso filesystem:", e);
    }
  }
  try {
    fs.writeFileSync(fsFile(slug), JSON.stringify(data, null, 2));
  } catch (e) {
    // En serverless sin KV esto es esperable: la sesión sigue viva en memoria
    // del request y Pusher ya transmitió el evento a la pantalla pública.
    console.error("[store] No se pudo persistir en disco:", e);
  }
}
