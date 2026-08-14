import { NextResponse } from "next/server";
import { pusherServer } from "@/lib/pusher";

const METRICS_PROMPT = `Sos un analista en tiempo real de pitches de e-commerce e inteligencia artificial para eCommerce StartUp Competition.

Analizá el transcript acumulado de la presentación y asigná un puntaje de 0 a 100 (donde 50 es neutral/medio) para cada uno de los 6 indicadores:

1. mercado (🌍 Potencial de Mercado)
2. producto (🧲 Producto y Adopción)
3. innovacion (🧱 Innovación y Tecnología)
4. ejecucion (🏃‍♂️ Ejecución y Avance)
5. equipo (👥 Perfil del Equipo y Visión)
6. percepcion (👁️ Percepción Personal)

Responde EXCLUSIVAMENTE un JSON válido con esta estructura exacta (sin texto extra):
{
  "mercado": 65,
  "producto": 70,
  "innovacion": 80,
  "ejecucion": 55,
  "equipo": 75,
  "percepcion": 68
}`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    const { team, project, transcript } = body;

    if (!transcript || transcript.length < 5) {
      // Default initial neutral values (50% middle)
      const defaultMetrics = {
        mercado: 50,
        producto: 50,
        innovacion: 50,
        ejecucion: 50,
        equipo: 50,
        percepcion: 50
      };
      
      await pusherServer.trigger("eday-pitch-channel", "live-metrics", {
        team: team || "Equipo",
        metrics: defaultMetrics
      });

      return NextResponse.json({ success: true, metrics: defaultMetrics });
    }

    if (!apiKey) {
      return NextResponse.json({ error: "Falta GEMINI_API_KEY" }, { status: 500 });
    }

    const userPrompt = `EQUIPO: ${team}
PROYECTO: ${project}
TRANSCRIPCIÓN:
${transcript}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${METRICS_PROMPT}\n\n${userPrompt}` }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: "Error en Gemini API", detail: errText }, { status: res.status });
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    
    let metrics = {
      mercado: 50,
      producto: 50,
      innovacion: 50,
      ejecucion: 50,
      equipo: 50,
      percepcion: 50
    };

    try {
      const parsed = JSON.parse(rawText);
      metrics = {
        mercado: Math.min(100, Math.max(0, Number(parsed.mercado) || 50)),
        producto: Math.min(100, Math.max(0, Number(parsed.producto) || 50)),
        innovacion: Math.min(100, Math.max(0, Number(parsed.innovacion) || 50)),
        ejecucion: Math.min(100, Math.max(0, Number(parsed.ejecucion) || 50)),
        equipo: Math.min(100, Math.max(0, Number(parsed.equipo) || 50)),
        percepcion: Math.min(100, Math.max(0, Number(parsed.percepcion) || 50)),
      };
    } catch {}

    // Broadcast live metric updates via Pusher WebSockets
    await pusherServer.trigger("eday-pitch-channel", "live-metrics", {
      team: team || "Equipo",
      metrics
    });

    return NextResponse.json({ success: true, team, metrics });

  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error evaluando métricas" }, { status: 500 });
  }
}
