import { NextResponse } from "next/server";
import { INDICATORS } from "@/lib/criteria";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** El operador está esperando para pasar al siguiente equipo: no puede colgarse. */
const TIMEOUT_MS = 45_000;

/**
 * Genera la ficha de evaluación completa de un equipo al terminar su pitch.
 *
 * Es distinto de /api/answer: aquel es feedback corto para el operador durante
 * la presentación; esto es el documento final, con el mismo formato y el mismo
 * nivel de detalle que las fichas de referencia que ya muestra el dashboard
 * (RESUMEN / FORTALEZAS por indicador / ÁREAS DE MEJORA / VEREDICTO).
 *
 * El formato importa: public/index.html parsea los títulos `**ASÍ**` para
 * dibujar cada sección, y el veredicto se renderiza destacado.
 */

const FICHA_PROMPT = `Sos el jurado evaluador de la eCommerce StartUp Competition Argentina 2026 (eCommerce Institute). Acabás de escuchar el pitch completo de un equipo y tenés que escribir su FICHA DE EVALUACIÓN.

## Los 6 indicadores oficiales
${INDICATORS.map((i, n) => `${n + 1}. ${i.icon} ${i.label}: ${i.description}`).join("\n")}

## Cómo tenés que escribir
Estás escribiendo para un jurado experto que NO tomó notas. La ficha tiene que servir para decidir un puntaje sin volver a escuchar el pitch.

- Sé CONCRETO. Nombrá las herramientas, los números, los tiempos, los costos y los porcentajes que se hayan dicho: "de 2.5 horas a 15 minutos diarios", "92% de coincidencia", "$990 USD", "Make con 5 módulos", "API de Claude".
- Usá CITAS TEXTUALES entre comillas cuando el orador dijo algo revelador. Copiá sus palabras, no las parafrasees.
- NO INVENTES NADA. Si un dato no está en la transcripción, no lo pongas. Si un indicador no se puede evaluar porque el equipo no habló del tema, escribilo tal cual: "No dio información sobre esto durante el pitch".
- Nada de elogios genéricos. "Buena presentación" no sirve; "corrió el agente en vivo y procesó un extracto real del banco LGT" sí.
- Las áreas de mejora tienen que ser específicas y accionables, no formalidades.
- Escribí en español rioplatense, en el tono profesional y directo de un jurado técnico.

## Formato EXACTO de salida
Respondé ÚNICAMENTE con el texto de la ficha, sin preámbulo, sin explicaciones y sin bloques de código. Respetá los títulos y las viñetas al carácter:

**RESUMEN DEL PROYECTO**
Un párrafo: quién presenta, a qué se dedica, qué construyó y cuál es el dolor concreto que resuelve. Incluí una cita textual del dolor si la hay.

**FORTALEZAS**
• **🌍 Potencial de Mercado:** …
• **🧲 Producto y Adopción:** …
• **🧱 Innovación y Tecnología:** …
• **🏃 Ejecución y Avance:** …
• **👥 Perfil del Equipo y Visión:** …
• **👁️ Percepción Personal:** …

**ÁREAS DE MEJORA**
• Primera mejora concreta.
• Segunda mejora concreta.

**VEREDICTO**
Dos a cuatro oraciones de síntesis: qué es lo más fuerte, qué es lo más flojo y qué tan sólido es el caso en conjunto.`;

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

    const team = body.team || "Equipo";
    const project = body.project || "";
    const transcript = (body.transcript || "").trim();
    const metrics: Record<string, number> | null = body.metrics || null;
    const lecturas: number = Number(body.lecturas) || 0;

    if (transcript.length < 200) {
      return NextResponse.json(
        { error: "La transcripción es demasiado corta para generar una ficha." },
        { status: 400 }
      );
    }

    /**
     * La medición en vivo entra al prompt.
     *
     * Sin esto la ficha y los indicadores se generaban por separado y podían
     * contradecirse: un texto que elogia la ejecución al lado de un medidor de
     * Ejecución en 37 se lee como que el sistema está roto. Ahora el veredicto
     * escrito tiene que ser consistente con lo que la sala vio en pantalla.
     */
    const bloqueMedicion =
      metrics && lecturas > 0
        ? `\nMEDICIÓN EN VIVO AL CIERRE (0-100, 50 = neutro; ${lecturas} lecturas durante el pitch):
${INDICATORS.map((i) => `- ${i.label}: ${metrics[i.key] ?? 50}`).join("\n")}

Esta medición se proyectó en pantalla durante el pitch. Tu ficha tiene que ser COHERENTE con ella: no elogies un indicador que quedó bajo ni castigues uno que quedó alto. Si creés que la medición se equivocó en algún punto, decilo explícitamente en ÁREAS DE MEJORA en vez de contradecirla en silencio.\n`
        : "";

    const userPrompt = `EQUIPO: ${team}
PROYECTO: ${project}
${bloqueMedicion}
TRANSCRIPCIÓN COMPLETA DEL PITCH:
${transcript}`;

    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controlador.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${FICHA_PROMPT}\n\n${userPrompt}` }] }],
          generationConfig: {
            // Baja para que se pegue a los datos del transcript en vez de adornar.
            temperature: 0.4,
            maxOutputTokens: 2400,
          },
        }),
        }
      );
    } catch (e: any) {
      clearTimeout(corte);
      return NextResponse.json(
        { error: e?.name === "AbortError" ? "La generación de la ficha tardó demasiado." : "No se pudo contactar al modelo." },
        { status: 504 }
      );
    }
    clearTimeout(corte);

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: "Error en Gemini API", detail: detail.slice(0, 400) },
        { status: res.status }
      );
    }

    const data = await res.json();
    let raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // A veces el modelo envuelve todo en un bloque de código pese a la consigna.
    raw = raw.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```$/, "").trim();

    if (!raw.includes("**VEREDICTO**")) {
      return NextResponse.json(
        { error: "El modelo no devolvió la ficha en el formato esperado.", raw },
        { status: 502 }
      );
    }

    return NextResponse.json({ raw, team, project });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error generando la ficha." },
      { status: 500 }
    );
  }
}
