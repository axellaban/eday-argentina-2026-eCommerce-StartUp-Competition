/**
 * La planilla del jurado, como fuente de los nombres de los equipos.
 *
 * El copiloto tenía la lista de equipos escrita a mano en el código. El día que
 * cambió un nombre en la planilla, el desplegable siguió mostrando el viejo: el
 * operador elegía "Ceci Escudero" mientras el Sheet decía otra cosa, y el
 * dashboard cruza las fichas con los puntajes del jurado POR NOMBRE. Dos
 * nombres distintos para la misma persona significa una ficha que nunca
 * encuentra su fila.
 *
 * Ahora los nombres salen de la columna B de la hoja `Análisis`, que es la
 * misma que lee el dashboard. Una sola fuente.
 *
 * CADA COMPETICIÓN TIENE SU PLANILLA. El id de la hoja dejó de ser una
 * constante y sale del registro: si fuera fija, el copiloto de AI Unified
 * Commerce ofrecería los equipos de la StartUp Competition, y como el
 * dashboard cruza fichas con puntajes POR NOMBRE, esas fichas no encontrarían
 * ninguna fila.
 */

import type { Competencia } from "./competencias";

/**
 * Variantes del nombre de la hoja.
 *
 * Si el nombre no resuelve, Google devuelve la PRIMERA hoja del libro —la de
 * respuestas del formulario— sin avisar, y el parseo sale vacío. Se prueban las
 * variantes con y sin tilde, igual que en el dashboard.
 */
export function nombresDeHoja(sheetName: string): string[] {
  // \u0300-\u036f son las marcas diacríticas combinantes: "Análisis" → "Analisis".
  const sinTilde = sheetName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return Array.from(new Set([sheetName, sinTilde, sheetName.toLowerCase(), sinTilde.toLowerCase()]));
}

export const csvUrl = (sheetId: string, hoja: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(hoja)}`;

/** Por gid no hay ambigüedad posible: es el identificador de la pestaña. */
export const csvUrlGid = (sheetId: string, gid: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;

/**
 * ¿Esto es la hoja del jurado, o la de respuestas del formulario?
 *
 * Cuando el nombre de hoja no resuelve, Google devuelve la primera del libro
 * SIN marcar error. En estas planillas esa es la del formulario, donde la
 * columna B son los jurados que votaron. El dashboard los mostraba como si
 * fueran los equipos que presentan.
 *
 * La hoja de análisis siempre tiene "Nombre" en la columna B. Con eso alcanza
 * para distinguirlas y descartar la equivocada en vez de darla por buena.
 */
export function pareceHojaDeAnalisis(filas: string[][]): boolean {
  const encabezado = filas[0];
  if (!encabezado || encabezado.length < 3) return false;
  const colB = String(encabezado[1] || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase();
  return colB === "nombre";
}

/**
 * Parser de CSV que respeta las comillas.
 *
 * Los nombres de equipo pueden traer comas ("Pérez, Ana") y un `split(",")`
 * las partiría al medio. Google escapa las comillas internas duplicándolas.
 */
export function filasCSV(texto: string): string[][] {
  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') enComillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

/**
 * Tope duro de filas que se leen de la columna B.
 *
 * Es una red contra una planilla con basura abajo (miles de filas vacías con
 * un espacio suelto), NO un límite de participantes: si alguna vez recorta
 * equipos de verdad, el número está mal. Estaba en 20 cuando eran "unos diez
 * por competición"; la StartUp Competition ya trae 16 y ese margen era una
 * fila de distancia de perder un equipo en silencio, que es la peor forma de
 * fallar acá.
 */
const MAX_EQUIPOS = 100;

/** Por qué la lista vino vacía. Sirve para decirlo en pantalla en vez de un "no hay equipos" a secas. */
export type MotivoSinEquipos =
  | "sin-planilla"      // la competición no tiene sheetId cargado
  | "sin-respuesta"     // Google no contestó, o tardó más de la cuenta
  | "hoja-equivocada"   // contestó, pero con otra hoja (la del formulario)
  | "hoja-vacia";       // es la hoja correcta y no tiene nombres cargados

export interface LecturaEquipos {
  equipos: string[];
  /** Presente sólo cuando `equipos` está vacío. */
  motivo?: MotivoSinEquipos;
}

/**
 * Los nombres de la columna B de la hoja de análisis, salteando el encabezado.
 *
 * NO hay un rango fijo de filas. Se leen todas las que tengan nombre, así que
 * cuando el jurado suma o saca equipos de la planilla esto lo toma solo, sin
 * tocar el código. Un rango escrito a mano —"B2:B11"— habría que actualizarlo
 * cada vez que cambia la lista, y el día que alguien se olvide el equipo 12
 * simplemente no aparece.
 *
 * Con la lista vacía devuelve el motivo. Antes todos los finales eran el mismo
 * `[]`: "Google no contestó" y "Google contestó con la hoja del formulario" se
 * veían igual en pantalla, y son dos problemas con dos soluciones distintas
 * (esperar vs. cargar el gid de la pestaña).
 *
 * Acá no se inventa una lista de reemplazo: una lista inventada es exactamente
 * el problema que esto vino a resolver.
 */
export async function equiposDelSheet(comp: Competencia): Promise<LecturaEquipos> {
  if (!comp.sheetId) return { equipos: [], motivo: "sin-planilla" };
  // Con gid se pide una sola vez y no hay lugar para la confusión.
  const urls = comp.sheetGid
    ? [csvUrlGid(comp.sheetId, comp.sheetGid)]
    : nombresDeHoja(comp.sheetName).map((h) => csvUrl(comp.sheetId, h));

  // El último motivo pisa al anterior: si alguna variante del nombre llegó a
  // traer la hoja equivocada, eso es más informativo que "no contestó".
  let motivo: MotivoSinEquipos = "sin-respuesta";

  for (const base of urls) {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), 8000);
    try {
      const res = await fetch(`${base}&cachebust=${Date.now()}`, {
        cache: "no-store",
        signal: corte.signal,
      });
      if (!res.ok) continue;

      const filas = filasCSV(await res.text());
      // Si no es la hoja del jurado, se descarta: mejor sin equipos que con
      // los nombres de quienes votaron.
      if (!pareceHojaDeAnalisis(filas)) { motivo = "hoja-equivocada"; continue; }

      const nombres = filas
        .slice(1)                                    // fila 1 = encabezado
        .map((f) => String(f[1] ?? "").trim())       // columna B
        .filter(Boolean)
        // Los subtotales y las filas de cierre que a veces cuelgan abajo.
        .filter((n) => !/^(total|promedio|media|equipo)$/i.test(n));

      // Sin duplicados: el nombre es la clave con la que se guarda la sesión.
      const unicos = Array.from(new Set(nombres)).slice(0, MAX_EQUIPOS);
      if (unicos.length) return { equipos: unicos };
      motivo = "hoja-vacia";
    } catch {
      // Si Google no contesta, no contesta para ninguna variante del nombre:
      // probar las otras tres sólo suma segundos de espera.
      if (corte.signal.aborted) break;
    } finally {
      clearTimeout(reloj);
    }
  }
  return { equipos: [], motivo };
}
