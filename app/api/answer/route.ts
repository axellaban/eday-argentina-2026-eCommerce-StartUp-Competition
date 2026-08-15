import { NextResponse } from "next/server";
import { urlGemini } from "@/lib/gemini";
import { INDICATORS_PROMPT_BLOCK } from "@/lib/criteria";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

/** Sin esto, si Gemini se cuelga el botón queda en "Analizando…" para siempre. */
const TIMEOUT_MS = 30_000;

const COMPETITION_PROMPT = `Sos el EVALUADOR COPILOTO Y JURADO ASISTENTE de la eCommerce StartUp Competition Argentina 2026 (eCommerce Institute).

Recibís:
1. EQUIPO QUE PRESENTA: Nombre del equipo y/o proyecto.
2. LOS 6 INDICADORES OFICIALES DE EVALUACIÓN (el jurado puntúa cada uno de 1 a 5):
${INDICATORS_PROMPT_BLOCK}
3. TRANSCRIPCIÓN EN TIEMPO REAL de lo que está exponiendo el equipo o preguntando el jurado.

Tu objetivo:
Analizar la presentación en vivo y generar feedback conciso, estructurado y directo para el jurado y el equipo.

## Formato de Respuesta:
**1) Sugerencia / Feedback Clave**
- Una oración directa con la idea central o respuesta a la pregunta del jurado.

**2) Análisis por Indicador**
- **🌍 Potencial de Mercado:** Tamaño real de la oportunidad.
- **🧲 Producto y Adopción:** Qué tan usable es y quién lo está usando.
- **🧱 Innovación y Tecnología:** Calidad del stack agéntico (APIs, agentes, memoria).
- **🏃 Ejecución y Avance:** Qué tan lejos llegaron y qué mostraron funcionando.
- **👥 Perfil del Equipo y Visión:** Capacidad de llevarlo adelante.
- **👁️ Percepción Personal:** Impresión general del pitch.

**💡 Veredicto sugerido para la Ficha:**
Resumen sintético del pitch en 2-3 líneas para la Ficha IA, con una sugerencia de puntaje de 1 a 5 por indicador.`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Falta GEMINI_API_KEY en las variables de entorno." },
        { status: 500 }
      );
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

    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(
        await urlGemini(apiKey),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controlador.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `${COMPETITION_PROMPT}\n\n${userPrompt}` }] }],
          }),
        }
      );
    } catch (e: any) {
      clearTimeout(corte);
      return NextResponse.json(
        { error: e?.name === "AbortError" ? "El análisis tardó demasiado. Probá de nuevo." : "No se pudo contactar al modelo." },
        { status: 504 }
      );
    }
    clearTimeout(corte);

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: "Error en Gemini API", detail: errText },
        { status: res.status }
      );
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta del modelo.";

    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error procesando solicitud." },
      { status: 500 }
    );
  }
}
