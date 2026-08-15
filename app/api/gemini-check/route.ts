import { NextResponse } from "next/server";
import { motivoGemini } from "@/lib/gemini-error";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODELO = "gemini-2.5-flash";

/**
 * Diagnóstico de la conexión con Gemini.
 *
 * Cuando en pleno evento los seis indicadores se quedan quietos, hay que poder
 * distinguir en diez segundos entre: la key no está cargada, la key es
 * inválida, se acabó la cuota, o el modelo no está habilitado para esa cuenta.
 * Cada una se arregla distinto y no hay tiempo para adivinar.
 *
 * Queda detrás de la contraseña del operador (el middleware protege todo
 * /api/* menos el GET de fichas), así que gasta una llamada mínima y sólo la
 * gasta quien puede operar. Nunca devuelve la API key, sólo si está y cuánto
 * mide: alcanza para detectar el error más común, que es haberla pegado con
 * espacios o cortada.
 */
export async function GET() {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const bruta = process.env.GEMINI_API_KEY || "";

  const base = {
    modelo: MODELO,
    keyPresente: Boolean(apiKey),
    keyLargo: apiKey.length,
    keyConEspacios: bruta !== bruta.trim(),
  };

  if (!apiKey) {
    return NextResponse.json(
      { ...base, ok: false, motivo: "No hay GEMINI_API_KEY cargada en el entorno." },
      { status: 500 }
    );
  }

  // 1) ¿La key sirve y el modelo está habilitado para esta cuenta?
  let modeloDisponible: boolean | null = null;
  try {
    const lista = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { cache: "no-store" }
    );
    if (lista.ok) {
      const j = await lista.json();
      const nombres: string[] = (j.models || []).map((m: any) => String(m.name || ""));
      modeloDisponible = nombres.some((n) => n.includes(MODELO));
    }
  } catch {
    // No es concluyente: lo que manda es la llamada real de abajo.
  }

  // 2) La llamada real, igual de chica que las del evento pero mínima.
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Respondé sólo: ok" }] }],
          generationConfig: { maxOutputTokens: 5, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ...base, modeloDisponible, ok: false, motivo: `No se pudo contactar a Google: ${e?.message || "error de red"}` },
      { status: 504 }
    );
  }

  const ms = Date.now() - t0;

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    return NextResponse.json(
      {
        ...base,
        modeloDisponible,
        ok: false,
        status: res.status,
        ms,
        motivo: motivoGemini(res.status, cuerpo),
        respuestaCruda: cuerpo.slice(0, 500),
      },
      { status: 200 } // 200 a propósito: el diagnóstico funcionó, lo que falló es Gemini.
    );
  }

  return NextResponse.json({
    ...base,
    modeloDisponible,
    ok: true,
    status: 200,
    ms,
    motivo: `Gemini responde bien en ${ms}ms.`,
  });
}
