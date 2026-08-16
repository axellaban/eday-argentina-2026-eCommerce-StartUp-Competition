import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Entrega al navegador una credencial EFÍMERA de Deepgram.
 *
 * Regla que no se rompe: DEEPGRAM_API_KEY nunca sale de acá. La versión vieja
 * tenía un fallback que, si esto fallaba, mandaba la key maestra al navegador;
 * cualquiera que hiciera POST se la llevaba.
 *
 * Se intentan dos caminos, ambos seguros:
 *   1. POST /v1/auth/grant  → access_token de corta vida (esquema "bearer").
 *      Requiere que la key tenga permiso para emitir tokens.
 *   2. Crear una API key temporal con scope mínimo (usage:write) y TTL corto
 *      vía la Keys API (esquema "token"). Requiere permiso keys:write.
 *
 * Si los dos fallan, devolvemos 502 con el detalle de cada intento para poder
 * diagnosticar sin adivinar.
 */

const DG = "https://api.deepgram.com";
/**
 * Media hora de vida para la credencial.
 *
 * Estaba en 10 minutos, que es exactamente lo que dura un pitch: la
 * credencial vencía justo mientras alguien estaba hablando. El corte lo
 * absorbe la reconexión automática del copiloto, pero cada reconexión se come
 * un par de segundos de audio, y se los come en el peor momento posible —el
 * cierre del pitch, donde están los números y el veredicto—. Media hora saca
 * el vencimiento de adentro de la presentación sin dejar el token dando
 * vueltas: el máximo que acepta Deepgram es una hora.
 */
const TTL = 1800;

function apiKey(): string {
  return (process.env.DEEPGRAM_API_KEY || "").trim().replace(/^["']|["']$/g, "");
}

function authHeaders(key: string) {
  return { Authorization: `Token ${key}`, "Content-Type": "application/json" };
}

async function readError(r: Response): Promise<string> {
  const text = await r.text().catch(() => "");
  return `HTTP ${r.status} ${text.slice(0, 300)}`.trim();
}

/** Camino 1: token efímero nativo. */
async function viaGrant(key: string): Promise<{ token: string; scheme: string; expires_in: number } | string> {
  try {
    const r = await fetch(`${DG}/v1/auth/grant`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({ ttl_seconds: TTL }),
    });
    if (!r.ok) return await readError(r);
    const j: any = await r.json().catch(() => ({}));
    if (!j.access_token) return "respuesta sin access_token";
    return { token: j.access_token, scheme: "bearer", expires_in: j.expires_in ?? TTL };
  } catch (e: any) {
    return e?.message || "error de red";
  }
}

/** Camino 2: API key temporal con scope mínimo y vencimiento. */
async function viaTempKey(key: string): Promise<{ token: string; scheme: string; expires_in: number } | string> {
  try {
    let projectId = (process.env.DEEPGRAM_PROJECT_ID || "").trim();

    if (!projectId) {
      const pr = await fetch(`${DG}/v1/projects`, { headers: authHeaders(key) });
      if (!pr.ok) return `no se pudo listar proyectos: ${await readError(pr)}`;
      const pj: any = await pr.json().catch(() => ({}));
      projectId = pj?.projects?.[0]?.project_id || "";
      if (!projectId) return "la cuenta no devolvió ningún project_id";
    }

    const r = await fetch(`${DG}/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({
        comment: `copiloto-eday-${Date.now()}`,
        scopes: ["usage:write"],
        time_to_live_in_seconds: TTL,
      }),
    });
    if (!r.ok) return `no se pudo crear key temporal: ${await readError(r)}`;

    const j: any = await r.json().catch(() => ({}));
    if (!j.key) return "respuesta sin key temporal";
    return { token: j.key, scheme: "token", expires_in: TTL };
  } catch (e: any) {
    return e?.message || "error de red";
  }
}

async function mintCredential() {
  const key = apiKey();
  if (!key) return { error: "Falta DEEPGRAM_API_KEY en las variables de entorno.", status: 500 };

  const intentos: Record<string, string> = {};

  const grant = await viaGrant(key);
  if (typeof grant !== "string") return { ok: grant, via: "auth/grant" };
  intentos["auth/grant"] = grant;

  const temp = await viaTempKey(key);
  if (typeof temp !== "string") return { ok: temp, via: "key temporal" };
  intentos["key temporal"] = temp;

  return {
    error: "Deepgram rechazó los dos métodos de credencial efímera.",
    intentos,
    ayuda:
      "Suele ser permisos: la DEEPGRAM_API_KEY tiene que ser de un miembro con rol owner/admin del proyecto. " +
      "Generá una key nueva con permisos completos en console.deepgram.com y actualizá la variable en Vercel.",
    status: 502,
  };
}

export async function POST() {
  const res = await mintCredential();
  if ("ok" in res && res.ok) {
    return NextResponse.json({ ...res.ok, via: res.via });
  }
  const { status, ...body } = res as any;
  return NextResponse.json(body, { status });
}

/**
 * Diagnóstico: dice qué método funciona sin exponer ninguna credencial.
 * Abrilo en el navegador estando logueado.
 */
export async function GET() {
  const key = apiKey();
  if (!key) {
    return NextResponse.json({ configurada: false, error: "Falta DEEPGRAM_API_KEY." }, { status: 500 });
  }

  const grant = await viaGrant(key);
  const temp = typeof grant === "string" ? await viaTempKey(key) : null;

  return NextResponse.json({
    configurada: true,
    largoDeLaKey: key.length,
    "auth/grant": typeof grant === "string" ? { ok: false, motivo: grant } : { ok: true },
    "key temporal":
      temp === null
        ? "no hizo falta probarlo"
        : typeof temp === "string"
        ? { ok: false, motivo: temp }
        : { ok: true },
  });
}
