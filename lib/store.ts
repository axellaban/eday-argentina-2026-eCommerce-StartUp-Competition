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
      return await kvGet();
    } catch (e) {
      console.error("[store] Falló la lectura de KV, uso filesystem:", e);
    }
  }
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
