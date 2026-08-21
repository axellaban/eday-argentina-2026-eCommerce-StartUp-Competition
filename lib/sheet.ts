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

import { Competencia } from "./competencias";

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

/** Tope de equipos: son unos diez por competición, con margen por si se suma alguno. */
const MAX_EQUIPOS = 20;

/**
 * Los nombres de la columna B, salteando el encabezado.
 *
 * Devuelve `[]` si la hoja no responde o viene vacía; quien llame decide qué
 * hacer con eso. Acá no se inventa una lista de reemplazo: una lista inventada
 * es exactamente el problema que esto vino a resolver.
 */
export async function equiposDelSheet(comp: Competencia): Promise<string[]> {
  if (!comp.sheetId) return [];
  for (const hoja of nombresDeHoja(comp.sheetName)) {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), 8000);
    try {
      const res = await fetch(`${csvUrl(comp.sheetId, hoja)}&cachebust=${Date.now()}`, {
        cache: "no-store",
        signal: corte.signal,
      });
      if (!res.ok) continue;

      const filas = filasCSV(await res.text());
      const nombres = filas
        .slice(1)                                    // fila 1 = encabezado
        .map((f) => String(f[1] ?? "").trim())       // columna B
        .filter(Boolean)
        // Los subtotales y las filas de cierre que a veces cuelgan abajo.
        .filter((n) => !/^(total|promedio|media|equipo)$/i.test(n));

      // Sin duplicados: el nombre es la clave con la que se guarda la sesión.
      const unicos = Array.from(new Set(nombres)).slice(0, MAX_EQUIPOS);
      if (unicos.length) return unicos;
    } catch {
      // Si Google no contesta, no contesta para ninguna variante del nombre:
      // probar las otras tres sólo suma segundos de espera.
      if (corte.signal.aborted) break;
    } finally {
      clearTimeout(reloj);
    }
  }
  return [];
}
