import { NextResponse } from "next/server";
import { Competencia, competenciaOrDefault } from "@/lib/competencias";
import { motivoGemini } from "@/lib/gemini-error";
import { urlGemini, olvidarModelo, textoGemini, corteGemini } from "@/lib/gemini";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** El operador está esperando para pasar al siguiente equipo: no puede colgarse. */
const TIMEOUT_MS = 45_000;

/**
 * Genera la ficha de evaluación completa de un equipo al terminar su pitch.
 *
 * Antes convivía con /api/answer, que daba feedback corto durante
 * la presentación; esto es el documento final, con el mismo formato y el mismo
 * nivel de detalle que las fichas de referencia que ya muestra el dashboard
 * (RESUMEN / FORTALEZAS por indicador / ÁREAS DE MEJORA / VEREDICTO).
 *
 * El formato importa: public/index.html parsea los títulos `**ASÍ**` para
 * dibujar cada sección, y el veredicto se renderiza destacado.
 */

function fichaPrompt(comp: Competencia): string {
  const total = comp.indicadores.length;
  return `Sos el jurado evaluador de la ${comp.nombre} (${comp.evento}, ${comp.organizador}). Acabás de escuchar el pitch completo de un equipo y tenés que escribir su FICHA DE EVALUACIÓN.

## Los ${total} indicadores oficiales
${comp.indicadores.map((i, n) => `${n + 1}. ${i.icon} ${i.label}: ${i.description}`).join("\n")}

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
${comp.indicadores.map((i) => `• **${i.icon} ${i.label}:** …`).join("\n")}

**ÁREAS DE MEJORA**
• Primera mejora concreta.
• Segunda mejora concreta.

**VEREDICTO**
Dos a cuatro oraciones de síntesis: qué es lo más fuerte, qué es lo más flojo y qué tan sólido es el caso en conjunto.`;
}

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

    const comp = competenciaOrDefault(body.competencia);
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
${comp.indicadores.map((i) => `- ${i.label}: ${metrics[i.key] ?? 50}`).join("\n")}

Esta medición se proyectó en pantalla durante el pitch. Tu ficha tiene que ser COHERENTE con ella: no elogies un indicador que quedó bajo ni castigues uno que quedó alto. Si creés que la medición se equivocó en algún punto, decilo explícitamente en ÁREAS DE MEJORA en vez de contradecirla en silencio.\n`
        : "";

    const userPrompt = `EQUIPO: ${team}
PROYECTO: ${project}
${bloqueMedicion}
TRANSCRIPCIÓN COMPLETA DEL PITCH:
${transcript}`;

    /**
     * Un reintento con espera.
     *
     * Esta llamada cae justo después de decenas de mediciones y marcados, así
     * que es la más expuesta a chocar el rate limit de Gemini — y es la que
     * menos se puede perder: es la ficha del equipo. Si el primer intento
     * falla por saturación, se espera y se prueba de nuevo.
     */
    const pedir = async (): Promise<Response> => {
      const controlador = new AbortController();
      const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS);
      try {
        return await fetch(
        await urlGemini(apiKey, "calidad"),
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controlador.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `${fichaPrompt(comp)}\n\n${userPrompt}` }] }],
          generationConfig: {
            // Baja para que se pegue a los datos del transcript en vez de adornar.
            temperature: 0.4,
            /**
             * Holgado, y no por capricho.
             *
             * Estaba en 2400 y el presupuesto lo comparten el razonamiento y
             * la respuesta. Con el modelo del perfil "calidad", que razona
             * antes de escribir, el razonamiento se llevaba la mayor parte y
             * la ficha salía cortada justo antes del VEREDICTO, que es la
             * última sección. La ficha entera son unos 1200 tokens: con 8000
             * no hay forma de que el corte caiga adentro del texto.
             */
            maxOutputTokens: 8000,
            /**
             * Que razone, pero con techo. Un poco de razonamiento es
             * justamente lo que se busca acá —es el documento que lee el
             * jurado— pero sin techo puede quedarse pensando y volver al
             * mismo problema por otro camino.
             */
            thinkingConfig: { thinkingBudget: 1024 },
          },
        }),
          }
        );
      } finally {
        clearTimeout(corte);
      }
    };

    let res: Response;
    try {
      res = await pedir();
      if (!res.ok && (res.status === 429 || res.status >= 500)) {
        await new Promise((r) => setTimeout(r, 2500));
        res = await pedir();
      }
    } catch (e: any) {
      return NextResponse.json(
        {
          error: e?.name === "AbortError"
            ? "La generación de la ficha tardó demasiado."
            : "No se pudo contactar al modelo.",
          detail: e?.message?.slice(0, 200),
        },
        { status: 504 }
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // El modelo elegido dejó de existir: se tira el cache para que la
      // próxima llamada vuelva a preguntar cuál está disponible.
      if (res.status === 404) olvidarModelo();
      return NextResponse.json(
        { error: motivoGemini(res.status, detail), detail: detail.slice(0, 300) },
        { status: res.status }
      );
    }

    const data = await res.json();
    const corteModelo = corteGemini(data);
    let raw = textoGemini(data);

    // A veces el modelo envuelve todo en un bloque de código pese a la consigna.
    raw = raw.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```$/, "").trim();

    /**
     * Qué hacer cuando falta el VEREDICTO.
     *
     * Antes se descartaba la ficha entera y el equipo se quedaba con un cartel
     * de error. Es la peor decisión posible en un evento en vivo: el veredicto
     * es la ÚLTIMA sección, así que lo que falta cuando falta es justo lo
     * último, y el resumen y las seis fortalezas —el 90% del documento y todo
     * el trabajo del modelo— ya estaban escritos.
     *
     * Ahora, si hay un texto con secciones reconocibles, se guarda igual y se
     * avisa que quedó incompleta. El dashboard dibuja las secciones que haya y
     * simplemente no pinta el bloque del veredicto. Sólo se descarta cuando de
     * verdad no vino nada aprovechable.
     */
    const tieneSecciones = /\*\*[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+\*\*/.test(raw);

    if (!raw.includes("**VEREDICTO**")) {
      if (raw.length >= 300 && tieneSecciones) {
        return NextResponse.json({
          raw,
          team,
          project,
          incompleta: true,
          motivo:
            corteModelo === "MAX_TOKENS"
              ? "La ficha quedó sin el veredicto: el modelo llegó al límite de largo."
              : "La ficha quedó sin el veredicto final.",
        });
      }

      return NextResponse.json(
        {
          error:
            corteModelo === "MAX_TOKENS"
              ? "El modelo cortó la respuesta por límite de largo antes de escribir la ficha."
              : corteModelo && corteModelo !== "STOP"
              ? `El modelo cortó la respuesta (${corteModelo}).`
              : "El modelo no devolvió la ficha en el formato esperado.",
          corte: corteModelo,
          raw,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ raw, team, project, competencia: comp.slug });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error generando la ficha." },
      { status: 500 }
    );
  }
}
