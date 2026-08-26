import registro from "@/competencias.json";

/**
 * Registro de competiciones.
 *
 * Antes había una sola competición y todo estaba clavado en constantes: los
 * indicadores en lib/criteria.ts, la planilla y sus etiquetas en
 * public/index.html, el nombre del evento adentro de los prompts, un único
 * canal de Pusher y una única clave de KV.
 *
 * Con dos competiciones el mismo día eso se rompe de tres formas distintas:
 * comparten historial, comparten planilla y —la peor— comparten el canal en
 * vivo, así que la pantalla de una termina proyectando los subtítulos de la
 * otra si alguien dejó la pestaña abierta.
 *
 * Acá vive todo lo que cambia entre una competición y otra. Para sumar una
 * nueva se agrega una entrada en competencias.json y no se toca nada más:
 * next.config.mjs lee el mismo archivo para generar sus rutas.
 *
 * Lo que NO cambia entre competiciones y por eso no está acá: la escala del
 * jurado (1 a 5 en la planilla), la escala del análisis en vivo (0 a 100, 50 =
 * neutro) y el formato de la ficha de evaluación.
 *
 * Los EQUIPOS tampoco están acá: salen de la columna B de la planilla, vía
 * /api/equipos. Ver lib/sheet.ts.
 */

export interface Indicator {
  /** Viaja en los eventos de Pusher y es la clave de `metrics`. Único dentro de la competición. */
  key: string;
  icon: string;
  label: string;
  /** Para los vértices del radar: los `label` largos se pisan entre sí. */
  short: string;
  /** Se inyecta en los prompts. Es lo que le dice al modelo qué está midiendo. */
  description: string;
}

export interface Competencia {
  slug: string;
  nombre: string;
  nombreCorto: string;
  evento: string;
  organizador: string;
  /** Color propio, para distinguir de un vistazo en qué competición está parado el operador. */
  acento: string;
  sheetId: string;
  sheetName: string;
  /**
   * El número que aparece en la URL de la pestaña (#gid=…).
   *
   * Si está, se usa en vez del nombre. El nombre es frágil: puede llevar
   * tilde o no, y cuando no resuelve Google NO da error — devuelve la primera
   * hoja del libro, que en estas planillas es la de respuestas del
   * formulario. El dashboard la tomaba por buena y mostraba a los jurados
   * como si fueran los equipos.
   */
  sheetGid?: string;
  /**
   * Disposición de la vista /ai. Por defecto, dos columnas.
   *
   * "columnas" (el default): transcript a la izquierda, radar e indicadores a
   * la derecha, preguntas y fichas a lo ancho abajo.
   * "apilado": el orden vertical de antes.
   *
   * No hace falta declararlo. Existe para poder devolver UNA competición al
   * apilado sin tocar las otras, si el día del evento algo no se ve bien en el
   * proyector de la sala.
   */
  layoutAI?: string;
  /**
   * Cuántos equipos tiene que traer la planilla. Es un CONTROL, no la fuente.
   *
   * Los nombres salen siempre de la columna B de la hoja de análisis y no hay
   * ningún rango fijo de filas: si el jurado suma o saca un equipo, la lista
   * se acomoda sola. Este número existe sólo para que una lectura incompleta
   * se vea. Cuando la hoja devuelve otra cantidad, el copiloto lo dice en
   * pantalla en vez de mostrar catorce equipos donde hay dieciséis, que es
   * algo que nadie nota hasta que falta uno en el escenario.
   *
   * Se puede dejar sin poner: sin el número no hay control, y la lista sigue
   * funcionando igual.
   */
  equiposEsperados?: number;
  indicadores: Indicator[];
}

export const COMPETENCIAS: Competencia[] = registro.competencias;

export const SLUGS: string[] = COMPETENCIAS.map((c) => c.slug);

/** La que se usa cuando no se indica ninguna. Es la primera del registro. */
export const SLUG_DEFAULT = COMPETENCIAS[0].slug;

export function getCompetencia(slug: string | null | undefined): Competencia | null {
  if (!slug) return null;
  return COMPETENCIAS.find((c) => c.slug === slug) || null;
}

/**
 * Igual que getCompetencia pero nunca devuelve null.
 *
 * Lo usan los endpoints: un slug desconocido no puede tumbar un pitch en vivo,
 * así que se cae a la primera competición en vez de tirar 500. El caso real es
 * una pestaña vieja abierta con una URL anterior.
 */
export function competenciaOrDefault(slug: string | null | undefined): Competencia {
  return getCompetencia(slug) || COMPETENCIAS[0];
}

/** Lee el slug de un Request, sea query string (?competencia=) o body ya parseado. */
export function slugDeRequest(req: Request): string | null {
  try {
    return new URL(req.url).searchParams.get("competencia");
  } catch {
    return null;
  }
}

/** Bloque de texto listo para inyectar en un prompt. */
export function indicadoresPromptBlock(c: Competencia): string {
  return c.indicadores
    .map((i, n) => `   ${n + 1}. ${i.key} (${i.icon} ${i.label}): ${i.description}`)
    .join("\n");
}

/** Valores neutros de arranque (0-100, 50 = neutro). */
export function neutralMetrics(c: Competencia): Record<string, number> {
  return Object.fromEntries(c.indicadores.map((i) => [i.key, 50]));
}

/**
 * Layout de la planilla del jurado, derivado de la cantidad de indicadores.
 *
 * Las dos planillas tienen la misma forma y sólo cambia el ancho:
 *   col 0 = Equipo N° (A) · col 1 = Nombre (B) · después un indicador por
 *   columna · y al final la Media Total.
 *
 * Con 6 indicadores la media cae en la columna I; con 8, en la K. Calcularlo
 * evita el caso especial por competición.
 */
export function layoutPlanilla(c: Competencia) {
  const primerIndicador = 2;
  const ultimoIndicador = primerIndicador + c.indicadores.length - 1;
  return {
    colEquipo: 0,
    colNombre: 1,
    primerIndicador,
    ultimoIndicador,
    colMediaTotal: ultimoIndicador + 1,
  };
}
