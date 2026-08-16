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
 * Si alguna vez esto tiene que soportar dos operadores a la vez, hay que pasar
 * a escrituras atómicas (JSON.SET de Redis o un script Lua) en vez de guardar
 * el blob completo.
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

const EMPTY: SessionsData = { sessions: {}, activeTeam: null };
const KV_KEY = "eday:sessions";

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

/** En Vercel el único directorio escribible es /tmp. */
function fsFile(): string {
  const dir = process.env.VERCEL ? "/tmp/eday-data" : path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "sessions.json");
}

async function kvGet(): Promise<SessionsData> {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(KV_KEY)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV GET ${res.status}`);
  const body = await res.json();
  // Upstash devuelve { result: "<string>" | null }
  if (!body || body.result == null) return { ...EMPTY };
  const raw = typeof body.result === "string" ? body.result : JSON.stringify(body.result);
  const parsed = JSON.parse(raw);
  return {
    sessions: parsed.sessions || {},
    activeTeam: parsed.activeTeam ?? null,
  };
}

async function kvSet(data: SessionsData): Promise<void> {
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(KV_KEY)}`, {
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

export async function loadSessions(): Promise<SessionsData> {
  if (isDurable()) {
    try {
      const data = await kvGet();
      ultimaFuente = "kv";
      return data;
    } catch (e) {
      console.error("[store] Falló la lectura de KV, uso filesystem:", e);
    }
  }
  ultimaFuente = "fs";
  try {
    const file = fsFile();
    if (!fs.existsSync(file)) return { ...EMPTY };
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return { sessions: parsed.sessions || {}, activeTeam: parsed.activeTeam ?? null };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveSessions(data: SessionsData): Promise<void> {
  if (isDurable()) {
    try {
      await kvSet(data);
      return;
    } catch (e) {
      console.error("[store] Falló la escritura en KV, uso filesystem:", e);
    }
  }
  try {
    fs.writeFileSync(fsFile(), JSON.stringify(data, null, 2));
  } catch (e) {
    // En serverless sin KV esto es esperable: la sesión sigue viva en memoria
    // del request y Pusher ya transmitió el evento a la pantalla pública.
    console.error("[store] No se pudo persistir en disco:", e);
  }
}
