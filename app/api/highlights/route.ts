import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TIMEOUT_MS = 20_000;
const MAX_TRANSCRIPT = 14_000;

/**
 * Marca el transcript para el jurado: qué tramos son evidencia dura, cuáles
 * son demo en vivo y cuáles son afirmaciones sin respaldo. Además propone las
 * preguntas de cierre.
 *
 * Esto vive SÓLO en el panel del operador y del jurado, nunca en la pantalla
 * pública: pintar de rojo la frase de un fundador proyectada en la sala,
 * mientras esa persona está en el escenario, es marcarle públicamente un error
 * que el modelo puede estar cometiendo.
 *
 * Decisión de diseño importante: el modelo devuelve CITAS TEXTUALES, no
 * posiciones de caracteres. Un LLM no cuenta caracteres de forma confiable y
 * los offsets salen corridos; una cita se busca en el texto y, si no aparece
 * exacta, simplemente se descarta.
 */

const TIPOS = ["dato", "demo", "flojo"] as const;

const PROMPT = `Sos el asistente del jurado de la eCommerce StartUp Competition Argentina 2026. Estás leyendo la transcripción de un pitch EN CURSO y tenés que marcarla para que el jurado pueda escanearla rápido y preparar sus preguntas.

## Qué marcar
Marcá SÓLO fragmentos que valgan la pena. Tres tipos:

- "dato": una afirmación con evidencia dura y verificable. Números, tiempos, costos, porcentajes, volúmenes, tiempo en producción. Ejemplos: "de 2.5 horas a 15 minutos diarios", "92% de coincidencia", "lleva tres semanas funcionando", "$990 USD al mes".
- "demo": el equipo mostró algo funcionando en vivo o describió lo que el sistema acaba de hacer delante de todos. Ejemplos: "acá se ve cómo detecta el ISIN sin clasificar", "lo dejé corriendo mientras presentaba".
- "flojo": una afirmación importante sin ningún respaldo. Generalidades, promesas a futuro, adjetivos en lugar de hechos. Ejemplos: "esto le sirve a cualquier empresa", "va a escalar sin problema", "el ahorro es enorme".

## Reglas
1. El campo "cita" tiene que ser una copia EXACTA Y LITERAL de un fragmento de la transcripción, carácter por carácter. Entre 4 y 25 palabras. Si no lo podés copiar exacto, no lo incluyas.
2. No marques dos veces el mismo fragmento ni fragmentos que se solapen.
3. Como máximo 14 marcas. Si hay pocas cosas destacables, devolvé pocas. Marcar todo es igual a no marcar nada.
4. "flojo" no es un castigo: es una señal de que al jurado le falta información sobre ese punto. Sé exigente pero justo.
5. Nunca inventes texto que no esté en la transcripción.

## Preguntas de cierre
Además, proponé hasta 5 preguntas concretas que el jurado debería hacer al terminar el pitch. Tienen que apuntar a lo que falta o a lo que habría que verificar, no a lo que ya se explicó. Directas, una oración cada una.

Si la transcripción es muy corta o todavía no dice nada sustancial, devolvé listas vacías.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    marcas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          cita: { type: "STRING" },
          tipo: { type: "STRING", enum: [...TIPOS] },
        },
        required: ["cita", "tipo"],
      },
    },
    preguntas: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["marcas", "preguntas"],
};

function recortar(t: string): string {
  return t.length <= MAX_TRANSCRIPT ? t : t.slice(-MAX_TRANSCRIPT);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    const transcript = String(body.transcript || "").trim();

    if (!apiKey) {
      return NextResponse.json({ error: "Falta GEMINI_API_KEY." }, { status: 500 });
    }
    if (transcript.length < 200) {
      return NextResponse.json({ marcas: [], preguntas: [] });
    }

    const prompt = `${PROMPT}

## Equipo
${body.team || "Equipo"}${body.project ? ` — ${body.project}` : ""}

## Transcripción
${recortar(transcript)}`;

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
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
              temperature: 0.2,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }
      );
    } catch (e: any) {
      clearTimeout(corte);
      return NextResponse.json(
        { error: e?.name === "AbortError" ? "El marcado tardó demasiado." : "No se pudo contactar al modelo." },
        { status: 504 }
      );
    }
    clearTimeout(corte);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "Error en Gemini API", detail: detail.slice(0, 300) },
        { status: res.status }
      );
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: "Formato inesperado del modelo." }, { status: 502 });
    }

    // Sólo sobreviven las citas que existen literalmente en el transcript.
    const vistas = new Set<string>();
    const marcas = (Array.isArray(parsed.marcas) ? parsed.marcas : [])
      .filter((m: any) => {
        const cita = String(m?.cita || "").trim();
        if (cita.length < 12 || !TIPOS.includes(m?.tipo)) return false;
        if (!transcript.includes(cita)) return false;
        if (vistas.has(cita)) return false;
        vistas.add(cita);
        return true;
      })
      .slice(0, 14)
      .map((m: any) => ({ cita: String(m.cita).trim(), tipo: m.tipo }));

    const preguntas = (Array.isArray(parsed.preguntas) ? parsed.preguntas : [])
      .map((p: any) => String(p || "").trim())
      .filter(Boolean)
      .slice(0, 5);

    return NextResponse.json({ marcas, preguntas, descartadas: (parsed.marcas?.length || 0) - marcas.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error marcando el transcript." }, { status: 500 });
  }
}
