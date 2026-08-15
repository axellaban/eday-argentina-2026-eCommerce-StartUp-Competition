import { NextResponse } from "next/server";
import { broadcast } from "@/lib/pusher";
import { PUSHER_EVENTS } from "@/lib/pusher-config";
import { INDICATORS, neutralMetrics } from "@/lib/criteria";
import { motivoGemini } from "@/lib/gemini-error";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Medición en vivo de los 6 indicadores mientras el equipo presenta.
 *
 * Lo que hace distinto a una simple llamada al LLM:
 *
 * 1. CONTINUIDAD. Cada lectura recibe la anterior y parte de ahí. Sin esto
 *    cada llamada es independiente y los valores saltan al azar entre
 *    lecturas: la pantalla muestra ruido, no señal.
 * 2. ESCALA ANCLADA. Se define qué significa cada banda. "0 a 100 donde 50 es
 *    neutro" sin más deja que el modelo invente su propia vara en cada
 *    llamada.
 * 3. PRUDENCIA AL PRINCIPIO. Un indicador del que todavía no se habló se
 *    queda cerca de 50 en vez de recibir un puntaje inventado.
 * 4. LÍMITE DE SALTO. Ningún indicador se mueve más de 12 puntos por lectura:
 *    un salto de 40 puntos en pantalla no le resulta creíble a nadie.
 * 5. NUNCA VUELVE A NEUTRO POR ERROR. Si el modelo falla o tarda, se
 *    conservan los valores anteriores. Antes un JSON mal formado mandaba las
 *    seis barras a 50 de golpe delante de la sala.
 */

/** Cuánto puede moverse un indicador entre dos lecturas consecutivas. */
const MAX_SALTO = 12;
/** Techo de caracteres de transcript que se mandan al modelo. */
const MAX_TRANSCRIPT = 14_000;
/** Si el modelo no contesta en esto, se corta y quedan los valores previos. */
const TIMEOUT_MS = 16_000;

const ESCALA = `## Qué significa cada valor (0 a 100)
- 0-20   Evidencia explícita en contra. El pitch mostró que este punto está mal resuelto.
- 21-40  Flojo. Se habló del tema y lo que se dijo genera dudas.
- 41-59  Neutro. Todavía no hay evidencia suficiente para inclinarse, o lo dicho es tibio.
- 60-79  Bien. Hay evidencia concreta a favor: datos, demo que funcionó, números verificables.
- 80-100 Excepcional. Evidencia fuerte y demostrada en vivo, con números y validación real.`;

const REGLAS = `## Reglas de medición
1. Partí SIEMPRE de los valores actuales que te paso. Son el estado de la medición hasta ahora.
2. Movés un indicador SOLO si el transcript aporta evidencia nueva sobre ese indicador. Si sobre un tema no se dijo nada nuevo, dejá el valor igual.
3. Nunca muevas un indicador más de 12 puntos respecto del valor actual. Esto es una medición que evoluciona, no un veredicto que se reescribe.
4. Si el equipo todavía no tocó el tema de un indicador, dejalo entre 45 y 55. No premies ni castigues por adelantado: el silencio no es una mala señal, es falta de datos.
5. Subí fuerte sólo ante hechos concretos: números ("de 4 horas a 20 minutos"), demos que corrieron en vivo, tiempo en producción, clientes reales, costos.
6. Bajá ante señales claras: la demo falló, no hay caso de uso real, no hay ningún número, es sólo una idea sin construir.
7. El entusiasmo del orador no es evidencia. Los adjetivos no son evidencia. Los hechos verificables sí.
8. Al principio del pitch casi todo debería estar cerca de 50. Es normal y correcto.`;

function clamp(v: unknown, fallback: number): number {
  // Ojo con null y "": Number(null) es 0 y Number("") es 0, así que sin este
  // corte un indicador que el modelo devuelve vacío se leería como un 0 real
  // y la barra se hundiría 12 puntos en cada lectura hasta el fondo.
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Recorta el transcript conservando el arranque (contexto) y lo último (lo nuevo). */
function recortar(t: string): string {
  if (t.length <= MAX_TRANSCRIPT) return t;
  const cabeza = t.slice(0, 3000);
  const cola = t.slice(-(MAX_TRANSCRIPT - 3000));
  return `${cabeza}\n\n[…tramo intermedio omitido por longitud…]\n\n${cola}`;
}

/** Estructura fija de salida: el modelo no puede devolver otra cosa. */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: Object.fromEntries(
    INDICATORS.map((i) => [i.key, { type: "INTEGER", description: i.label }])
  ),
  required: INDICATORS.map((i) => i.key),
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = (process.env.GEMINI_API_KEY || "").trim();
    const { team, project, transcript } = body;

    // Valores de los que parte esta lectura.
    const previas: Record<string, number> = Object.fromEntries(
      INDICATORS.map((i) => [i.key, clamp(body.previas?.[i.key], 50)])
    );

    if (!transcript || transcript.length < 5) {
      const iniciales = neutralMetrics();
      const result = await broadcast(PUSHER_EVENTS.metrics, {
        team: team || "Equipo",
        metrics: iniciales,
      });
      return NextResponse.json({
        success: true,
        metrics: iniciales,
        broadcastError: result.ok ? null : result.error,
      });
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "Falta GEMINI_API_KEY en las variables de entorno." },
        { status: 500 }
      );
    }

    const prompt = `Sos el analista en vivo de la eCommerce StartUp Competition Argentina 2026. Vas midiendo 6 indicadores mientras el equipo presenta, y tu medición se proyecta en pantalla para el público y el jurado.

## Los 6 indicadores
${INDICATORS.map((i, n) => `${n + 1}. ${i.key} (${i.label}): ${i.description}`).join("\n")}

${ESCALA}

${REGLAS}

## Estado actual de la medición
${INDICATORS.map((i) => `- ${i.key}: ${previas[i.key]}`).join("\n")}

## Equipo
${team || "Equipo"}${project ? ` — ${project}` : ""}

## Transcripción acumulada del pitch
${recortar(transcript)}

Devolvé el nuevo estado de los 6 indicadores.`;

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
              // Baja: esto es una medición, no un texto creativo.
              temperature: 0.15,
              // Sin cadena de razonamiento: acá importa la latencia, y la
              // tarea es puntuar contra una rúbrica, no razonar en varios pasos.
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }
      );
    } catch (e: any) {
      clearTimeout(corte);
      // Se conservan los valores previos: la pantalla no se mueve, pero no miente.
      return NextResponse.json(
        {
          error: e?.name === "AbortError" ? "El modelo tardó demasiado." : "No se pudo contactar al modelo.",
          metrics: previas,
        },
        { status: 504 }
      );
    }
    clearTimeout(corte);

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: motivoGemini(res.status, detail), detail: detail.slice(0, 300), metrics: previas },
        { status: res.status }
      );
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let crudas: Record<string, number>;
    try {
      const parsed = JSON.parse(rawText);
      crudas = Object.fromEntries(
        INDICATORS.map((i) => [i.key, clamp(parsed[i.key], previas[i.key])])
      );
    } catch {
      // Formato inesperado: mejor no mover nada que tirar todo a 50.
      return NextResponse.json(
        { error: "El modelo devolvió un formato inesperado.", metrics: previas },
        { status: 502 }
      );
    }

    // Freno de salto: la medición evoluciona, no pega volantazos.
    const metrics = Object.fromEntries(
      INDICATORS.map((i) => {
        const antes = previas[i.key];
        const propuesto = crudas[i.key];
        const delta = Math.max(-MAX_SALTO, Math.min(MAX_SALTO, propuesto - antes));
        return [i.key, antes + delta];
      })
    );

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
