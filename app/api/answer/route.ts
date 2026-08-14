import { NextResponse } from "next/server";

const COMPETITION_PROMPT = `Sos el EVALUADOR COPILOTO Y JURADO ASISTENTE de la eCommerce StartUp Competition Argentina 2026 (eCommerce Institute).

Recibís:
1. EQUIPO QUE PRESENTA: Nombre del equipo y/o proyecto.
2. CRITERIOS DE EVALUACIÓN OFICIALES (0 a 5 pts cada uno):
   - ⚡ Funciona en Vivo (demo real sin fallos)
   - 🧠 Arquitectura Agéntica (orquestación, conectores, prompts)
   - 🎯 Relevancia del Caso de Uso (dolor real de e-commerce/retail)
   - 📊 Impacto Medible (ahorro de tiempo, dinero, ROI)
   - 💡 ¿Me lo Robo? (innovación y replicabilidad)
3. TRANSCRIPCIÓN EN TIEMPO REAL de lo que está exponiendo el equipo o preguntando el jurado.

Tu objetivo:
Analizar la presentación en vivo y generar feedback conciso, estructurado y directo para el jurado y el equipo.

## Formato de Respuesta:
**1) Sugerencia / Feedback Clave**
- Una oración directa con la idea central o respuesta a la pregunta del jurado.

**2) Análisis por Criterio**
- **⚡ Funciona en Vivo:** Observaciones sobre la demo en vivo.
- **🧠 Arquitectura Agéntica:** Calidad del stack (APIs, agentes, memoria).
- **📊 Impacto & Relevancia:** Retorno de inversión y aplicación en e-commerce.

**💡 Veredicto sugerido para la Ficha:**
Resumen sintético del pitch en 2-3 líneas para la Ficha IA.`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Falta GEMINI_API_KEY en las variables de entorno." }, { status: 500 });
    }

    const team = body.team || body.company || "Equipo Presentador";
    const project = body.project || body.role || "Proyecto de IA";
    const transcript = body.transcript || "";
    const question = body.question || "";

    const userPrompt = `EQUIPO: ${team}
PROYECTO: ${project}
TRANSCRIPCIÓN EN VIVO:
${transcript}

ÚLTIMA PREGUNTA / PUNTO A EVALUAR:
${question || "(Analizar pitch acumulado)"}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: `${COMPETITION_PROMPT}\n\n${userPrompt}` }] }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: "Error en Gemini API", detail: errText }, { status: res.status });
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta del modelo.";

    return NextResponse.json({ text });

  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error procesando solicitud." }, { status: 500 });
  }
}
