/**
 * Qué modelo de Gemini usar, según para qué.
 *
 * El nombre estaba hardcodeado como "gemini-2.5-flash" en las cuatro rutas.
 * El día del evento Google contestó:
 *
 *   404 · "This model models/gemini-2.5-flash is no longer available to new
 *          users. Please update your code to use a newer model."
 *
 * La API key era nueva, así que ese modelo simplemente no existía para esa
 * cuenta. Con el nombre clavado en el código, el sistema entero quedaba mudo:
 * ni indicadores, ni preguntas, ni fichas.
 *
 * En vez de volver a clavar otro nombre —que va a envejecer igual— el modelo se
 * descubre preguntándole a la propia API qué tiene habilitado esa key.
 *
 * ## Dos perfiles, porque son dos trabajos distintos
 *
 * - "rapido": la medición en vivo, el marcado y el feedback corto. Corren cada
 *   12 o 24 segundos mientras la persona habla, contra una rúbrica anclada y
 *   con tope de 12 puntos de movimiento por lectura. Ahí lo que importa es la
 *   latencia y la consistencia, no la sofisticación: un modelo lite alcanza y
 *   contesta antes.
 *
 * - "calidad": la ficha final. Es UNA llamada por equipo, es el documento que
 *   queda y es lo que el jurado lee para decidir un puntaje. La diferencia de
 *   costo en veinte pitches son centavos; la de calidad se lee.
 *
 * Overrides del entorno, por si hay que forzar algo sin tocar código:
 *   GEMINI_MODEL          → fuerza los dos perfiles.
 *   GEMINI_MODEL_CALIDAD  → fuerza sólo el de la ficha final.
 */

export type Perfil = "rapido" | "calidad";

/**
 * El modelo elegido a mano para cada perfil, en orden de preferencia.
 *
 * No se usan a ciegas: sólo se toma el primero que aparezca en la lista de
 * modelos que la key tiene habilitados. Si ninguno está, se cae al ranking
 * automático. Así una preferencia que envejece no vuelve a dejar el evento sin
 * IA, que es exactamente lo que pasó con 2.5-flash.
 */
const PREFERIDOS: Record<Perfil, string[]> = {
  rapido: ["gemini-3.1-flash-lite", "gemini-3-flash-lite", "gemini-3.1-flash"],
  calidad: ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
};

/** Si el descubrimiento falla, al menos se intenta con un alias movible. */
const FALLBACK: Record<Perfil, string> = {
  rapido: "gemini-flash-lite-latest",
  calidad: "gemini-flash-latest",
};

/** Diez minutos: sobra para un evento y no se queda pegado para siempre. */
const TTL_MS = 10 * 60 * 1000;

const cache: Partial<Record<Perfil, { modelo: string; hasta: number }>> = {};

/**
 * Familias que no sirven para esto, por más que digan soportar generateContent.
 *
 * La lista real de una key mostró por qué hace falta ser estricto: además de
 * los sospechosos de siempre aparecían `gemini-3.1-flash-image`, un
 * `-video-understanding-eap` y `computer-use`, todos con puntaje alto por
 * llamarse "flash" y tener número de versión grande. Un modelo de imagen o uno
 * en early access no puede terminar eligiéndose solo para medir indicadores en
 * vivo durante el evento.
 */
const EXCLUIR =
  /embedding|aqa|imagen|veo|image|tts|audio|live|robotics|learnlm|gemma|eap\b|computer-use|customtools|omni|video-understanding|nano-banana|lyria/i;

export interface Candidato {
  nombre: string;
  puntaje: number;
}

/**
 * Ordena los modelos disponibles por qué tan bien encajan en cada perfil.
 *
 * Lo único que cambia entre perfiles es el signo del bonus "lite": para lo que
 * corre en vivo es una ventaja, para la ficha final es un descuento de
 * calidad. Todo lo demás —flash sobre pro, versión más alta, penalizar preview
 * y nombres con fecha— vale igual para los dos.
 */
export function puntuar(nombre: string, perfil: Perfil = "rapido"): number {
  const n = nombre.replace(/^models\//, "");
  if (EXCLUIR.test(n)) return -1;

  let p = 0;

  // Flash es el perfil que se necesita en los dos casos: pro es más caro y más
  // lento sin ganar nada para tareas tan acotadas.
  if (/flash/.test(n)) p += 40;
  else if (/pro/.test(n)) p += 10;

  if (/lite/.test(n)) p += perfil === "rapido" ? 6 : -6;

  // Versión: 3.7 le gana a 3.1, que le gana a 2.5.
  const v = n.match(/gemini-(\d+(?:\.\d+)?)/);
  if (v) p += parseFloat(v[1]) * 6;

  // Los alias "-latest" sobreviven a las rotaciones de Google.
  if (/latest/.test(n)) p += 5;

  // Preview y experimental funcionan, pero se caen sin aviso.
  if (/preview|exp\b|-exp-/.test(n)) p -= 8;

  // Nombres con fecha quedan viejos y se apagan.
  if (/-\d{3,4}$/.test(n)) p -= 3;

  return p;
}

/**
 * Pide la lista de modelos de la key y los ordena de mejor a peor.
 *
 * Con su propio corte a los 5 segundos. Esta llamada pasó a estar delante de
 * cada análisis, y el AbortController de las rutas sólo cubre la llamada al
 * modelo: si el endpoint de modelos se colgaba, la ruta entera se quedaba
 * esperando hasta el tope de la función, con el equipo presentando y los
 * indicadores congelados.
 */
export async function candidatosGemini(
  apiKey: string,
  perfil: Perfil = "rapido"
): Promise<Candidato[]> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), 5000);
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { cache: "no-store", signal: corte.signal }
    );
  } finally {
    clearTimeout(reloj);
  }
  if (!res.ok) return [];
  const j = await res.json();

  return (j.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m: any) => {
      const nombre = String(m.name || "").replace(/^models\//, "");
      return { nombre, puntaje: puntuar(nombre, perfil) };
    })
    .filter((c: Candidato) => c.puntaje >= 0)
    .sort((a: Candidato, b: Candidato) => b.puntaje - a.puntaje);
}

/**
 * El modelo a usar ahora para ese perfil. Resuelve una vez y cachea.
 *
 * Nunca tira: si el descubrimiento falla se devuelve el fallback y que la
 * llamada real dé el error de verdad, con su mensaje.
 */
export async function modeloGemini(apiKey: string, perfil: Perfil = "rapido"): Promise<string> {
  const forzado =
    (perfil === "calidad" ? (process.env.GEMINI_MODEL_CALIDAD || "").trim() : "") ||
    (process.env.GEMINI_MODEL || "").trim();
  if (forzado) return forzado;

  const guardado = cache[perfil];
  if (guardado && Date.now() < guardado.hasta) return guardado.modelo;

  let elegido = FALLBACK[perfil];
  try {
    const lista = await candidatosGemini(apiKey, perfil);
    const disponibles = new Set(lista.map((c) => c.nombre));
    const preferido = PREFERIDOS[perfil].find((m) => disponibles.has(m));
    if (preferido) elegido = preferido;
    else if (lista.length) elegido = lista[0].nombre;
  } catch {
    // Se queda con el fallback.
  }

  cache[perfil] = { modelo: elegido, hasta: Date.now() + TTL_MS };
  return elegido;
}

/**
 * Olvida los modelos cacheados.
 *
 * Se llama cuando Google devuelve 404 sobre el modelo elegido: significa que
 * dejó de existir a mitad de camino y hay que volver a preguntar en vez de
 * seguir pegándole a un nombre muerto hasta que venza el TTL. Se limpian los
 * dos perfiles porque un apagón de Google no suele venir solo.
 */
export function olvidarModelo(): void {
  delete cache.rapido;
  delete cache.calidad;
}

/**
 * El texto de la respuesta, juntando TODAS las partes y salteando las de
 * razonamiento.
 *
 * Las cuatro rutas leían `candidates[0].content.parts[0].text`, que era
 * correcto mientras todas usaban un modelo que no razona. Al separar el perfil
 * "calidad" para la ficha final, ese modelo empezó a devolver primero una
 * parte con el resumen de su razonamiento (`thought: true`) y recién después
 * la respuesta. Leyendo sólo `parts[0]` nos quedábamos con el razonamiento: no
 * contiene "**VEREDICTO**", así que la ficha se descartaba entera y en
 * pantalla salía "El modelo no devolvió la ficha en el formato esperado" con
 * la ficha buena ahí al lado, sin usar.
 *
 * Juntar las partes también cubre el caso de una respuesta larga partida en
 * varios fragmentos.
 */
export function textoGemini(data: any): string {
  const partes = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(partes)) return "";
  return partes
    .filter((p: any) => p && p.thought !== true && typeof p.text === "string")
    .map((p: any) => p.text)
    .join("")
    .trim();
}

/**
 * Por qué el modelo dejó de escribir. "MAX_TOKENS" es el que importa: significa
 * que la respuesta salió cortada y no que el modelo se haya equivocado, y son
 * dos cosas que se arreglan distinto.
 */
export function corteGemini(data: any): string {
  return String(data?.candidates?.[0]?.finishReason || "");
}

/** URL de generateContent para el modelo que corresponda a ese perfil. */
export async function urlGemini(apiKey: string, perfil: Perfil = "rapido"): Promise<string> {
  const modelo = await modeloGemini(apiKey, perfil);
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
}
