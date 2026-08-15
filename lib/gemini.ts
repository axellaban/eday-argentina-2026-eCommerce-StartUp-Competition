/**
 * Qué modelo de Gemini usar.
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
 * En vez de volver a clavar otro nombre —que va a envejecer igual— el modelo
 * se descubre preguntándole a la propia API qué tiene habilitado esa key, y se
 * elige el mejor candidato. Se resuelve una vez por instancia y se cachea.
 *
 * Si querés forzar uno, GEMINI_MODEL en el entorno gana sobre todo lo demás.
 */

/**
 * El modelo elegido a mano, en orden de preferencia.
 *
 * No se usa a ciegas: sólo se toma si aparece en la lista de modelos que la
 * key tiene habilitados. Si no está, se cae al ranking automático de abajo.
 * Así una preferencia que envejece no vuelve a dejar el evento sin IA.
 */
const PREFERIDOS = ["gemini-3.1-flash-lite", "gemini-3-flash-lite", "gemini-3.1-flash"];

/** Si el descubrimiento falla, al menos se intenta con el alias movible. */
const FALLBACK = "gemini-flash-latest";

/** Diez minutos: sobra para un evento y no se queda pegado para siempre. */
const TTL_MS = 10 * 60 * 1000;

let cache: { modelo: string; hasta: number } | null = null;

/** Familias que no sirven para esto, por más que soporten generateContent. */
const EXCLUIR = /embedding|aqa|imagen|veo|image-generation|tts|audio|live|robotics|learnlm/i;

export interface Candidato {
  nombre: string;
  puntaje: number;
}

/**
 * Ordena los modelos disponibles por qué tan bien encajan acá.
 *
 * Lo que se necesita es un modelo rápido y barato que sepa devolver JSON con
 * schema: mide seis indicadores cada 12 segundos mientras alguien habla. Un
 * modelo "pro" sería más caro y más lento sin ganar nada para esta tarea.
 */
export function puntuar(nombre: string): number {
  const n = nombre.replace(/^models\//, "");
  if (EXCLUIR.test(n)) return -1;

  let p = 0;

  // Flash es exactamente el perfil que se necesita.
  if (/flash/.test(n)) p += 40;
  else if (/pro/.test(n)) p += 10;

  // Entre flash y flash-lite, gana flash: lite ahorra plata pero acá el costo
  // ya es de centavos y la calidad de la medición es lo que se proyecta.
  if (/lite/.test(n)) p -= 6;

  // Versión: 3 le gana a 2.5, que le gana a 2.0.
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

/** Pide la lista de modelos de la key y los ordena de mejor a peor. */
export async function candidatosGemini(apiKey: string): Promise<Candidato[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const j = await res.json();

  return (j.models || [])
    .filter((m: any) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m: any) => {
      const nombre = String(m.name || "").replace(/^models\//, "");
      return { nombre, puntaje: puntuar(nombre) };
    })
    .filter((c: Candidato) => c.puntaje >= 0)
    .sort((a: Candidato, b: Candidato) => b.puntaje - a.puntaje);
}

/**
 * El modelo a usar ahora. Resuelve una vez y cachea.
 *
 * Nunca tira: si el descubrimiento falla se devuelve el fallback y que la
 * llamada real dé el error de verdad, con su mensaje.
 */
export async function modeloGemini(apiKey: string): Promise<string> {
  const forzado = (process.env.GEMINI_MODEL || "").trim();
  if (forzado) return forzado;

  if (cache && Date.now() < cache.hasta) return cache.modelo;

  let elegido = FALLBACK;
  try {
    const lista = await candidatosGemini(apiKey);
    const disponibles = new Set(lista.map((c) => c.nombre));
    const preferido = PREFERIDOS.find((m) => disponibles.has(m));
    if (preferido) elegido = preferido;
    else if (lista.length) elegido = lista[0].nombre;
  } catch {
    // Se queda con el fallback.
  }

  cache = { modelo: elegido, hasta: Date.now() + TTL_MS };
  return elegido;
}

/**
 * Olvida el modelo cacheado.
 *
 * Se llama cuando Google devuelve 404 sobre el modelo elegido: significa que
 * dejó de existir a mitad de camino y hay que volver a preguntar en vez de
 * seguir pegándole a un nombre muerto hasta que venza el TTL.
 */
export function olvidarModelo(): void {
  cache = null;
}

/** URL de generateContent para el modelo que corresponda. */
export async function urlGemini(apiKey: string): Promise<string> {
  const modelo = await modeloGemini(apiKey);
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
}
