import { NextResponse } from "next/server";
import { motivoGemini } from "@/lib/gemini-error";
import { candidatosGemini, modeloGemini, olvidarModelo } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Diagnóstico de la conexión con Gemini.
 *
 * Cuando en pleno evento los seis indicadores se quedan quietos, hay que poder
 * distinguir en diez segundos entre: la key no está cargada, la key es
 * inválida, se acabó la cuota, o el modelo no existe para esa cuenta. Cada una
 * se arregla distinto y no hay tiempo para adivinar.
 *
 * Fue exactamente así que apareció el problema real: `gemini-2.5-flash` estaba
 * hardcodeado y Google contestó "no longer available to new users". Por eso
 * ahora esta ruta también devuelve qué modelos tiene habilitados la key y cuál
 * quedó elegido, que es lo único que permite decidir sin adivinar.
 *
 * Queda detrás de la contraseña del operador (el middleware protege todo
 * /api/* menos el GET de fichas). Nunca devuelve la API key: sólo si está y
 * cuánto mide, que alcanza para detectar el error más común, que es haberla
 * pegado con espacios o cortada.
 */
export async function GET() {
  const bruta = process.env.GEMINI_API_KEY || "";
  const apiKey = bruta.trim();

  const base = {
    keyPresente: Boolean(apiKey),
    keyLargo: apiKey.length,
    keyConEspacios: bruta !== bruta.trim(),
    modeloForzado: (process.env.GEMINI_MODEL || "").trim() || null,
  };

  if (!apiKey) {
    return NextResponse.json(
      { ...base, ok: false, motivo: "No hay GEMINI_API_KEY cargada en el entorno." },
      { status: 500 }
    );
  }

  // Se descarta lo cacheado: si alguien entra acá es porque algo anda mal.
  olvidarModelo();

  let disponibles: string[] = [];
  try {
    disponibles = (await candidatosGemini(apiKey)).map((c) => `${c.nombre} (${c.puntaje})`);
  } catch {
    // No es concluyente: manda la llamada real de abajo.
  }

  const modelo = await modeloGemini(apiKey);

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Respondé sólo: ok" }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ...base, modelo, disponibles, ok: false, motivo: `No se pudo contactar a Google: ${e?.message || "error de red"}` },
      { status: 504 }
    );
  }

  const ms = Date.now() - t0;

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    if (res.status === 404) olvidarModelo();
    return NextResponse.json(
      {
        ...base,
        modelo,
        disponibles,
        ok: false,
        status: res.status,
        ms,
        motivo: motivoGemini(res.status, cuerpo),
        respuestaCruda: cuerpo.slice(0, 500),
      },
      // 200 a propósito: el diagnóstico funcionó, lo que falló es Gemini.
      { status: 200 }
    );
  }

  return NextResponse.json({
    ...base,
    modelo,
    disponibles,
    ok: true,
    status: 200,
    ms,
    motivo: `Gemini responde bien con ${modelo} en ${ms}ms.`,
  });
}
