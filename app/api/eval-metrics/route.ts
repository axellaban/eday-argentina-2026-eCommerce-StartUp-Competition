import { NextResponse } from "next/server";
import { broadcast } from "@/lib/pusher";
import { PUSHER_EVENTS } from "@/lib/pusher-config";
import { INDICATORS, INDICATORS_PROMPT_BLOCK, neutralMetrics } from "@/lib/criteria";

export const dynamic = "force-dynamic";

const METRICS_PROMPT = `Sos un analista en tiempo real de pitches de e-commerce e inteligencia artificial para la eCommerce StartUp Competition.

Analizá el transcript acumulado de la presentación y asigná un puntaje de 0 a 100 (donde 50 es neutral/medio) para cada uno de los 6 indicadores oficiales:

${INDICATORS_PROMPT_BLOCK}

Respondé EXCLUSIVAMENTE un JSON válido con esta estructura exacta (sin texto extra):
{
${INDICATORS.map((i) => `  "${i.key}": 50`).join(",\n")}
}`;

function clamp(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    const { team, project, transcript } = body;

    if (!transcript || transcript.length < 5) {
      const defaultMetrics = neutralMetrics();
      const result = await broadcast(PUSHER_EVENTS.metrics, {
        team: team || "Equipo",
        metrics: defaultMetrics,
      });
      return NextResponse.json({
        success: true,
        metrics: defaultMetrics,
        broadcastError: result.ok ? null : result.error,
      });
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "Falta GEMINI_API_KEY en las variables de entorno." },
        { status: 500 }
      );
    }

    const userPrompt = `EQUIPO: ${team}
PROYECTO: ${project}
TRANSCRIPCIÓN:
${transcript}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${METRICS_PROMPT}\n\n${userPrompt}` }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: "Error en Gemini API", detail: errText },
        { status: res.status }
      );
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    let metrics = neutralMetrics();
    try {
      const parsed = JSON.parse(rawText);
      metrics = Object.fromEntries(INDICATORS.map((i) => [i.key, clamp(parsed[i.key])]));
    } catch {
      // Si el modelo no devolvió JSON válido, quedan los neutros.
    }

    const result = await broadcast(PUSHER_EVENTS.metrics, { team: team || "Equipo", metrics });

    return NextResponse.json({
      success: true,
      team,
      metrics,
      broadcastError: result.ok ? null : result.error,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error evaluando métricas" },
      { status: 500 }
    );
  }
}
