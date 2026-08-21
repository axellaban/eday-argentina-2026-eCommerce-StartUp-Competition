import fs from "fs";
import path from "path";

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
 *
 * Por eso es una función y no una constante.
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

const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export function isDurable(): boolean {
  return Boolean(KV_URL && KV_TOKEN);
}

/** En Vercel el único directorio escribible es /tmp. Un archivo por competición. */
function fsFile(slug: string): string {
  const dir = process.env.VERCEL ? "/tmp/eday-data" : path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `sessions-${slug.replace(/[^a-z0-9-]/gi, "_")}.json`);
}

async function kvGet(slug: string): Promise<SessionsData> {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(kvKey(slug))}`, {
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

async function kvSet(slug: string, data: SessionsData): Promise<void> {
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(kvKey(slug))}`, {
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

export async function loadSessions(slug: string): Promise<SessionsData> {
  if (isDurable()) {
    try {
      return await kvGet(slug);
    } catch (e) {
      console.error("[store] Falló la lectura de KV, uso filesystem:", e);
    }
  }
  try {
    const file = fsFile(slug);
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
      await kvSet(slug, data);
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
