import { Competencia, Equipo } from "./competencias";

/**
 * Lectura de la planilla del jurado desde el servidor.
 *
 * El dashboard (public/index.html) ya la lee desde el navegador para los
 * puntajes. Esto es para lo otro que vive ahí: LOS EQUIPOS.
 *
 * Antes la lista de equipos del copiloto estaba escrita a mano en el código,
 * así que sumar un equipo o corregirle el nombre era editar un archivo y
 * redeployar. Con dos competiciones eso se duplicaba. Ahora sale de la misma
 * planilla en la que el jurado carga los puntajes, que es donde los
 * organizadores ya la mantienen.
 *
 * Se hace del lado del servidor y no del navegador para poder cruzarla con el
 * registro —de donde salen las descripciones de proyecto, que la planilla no
 * tiene— en un solo lugar.
 */

/** Si Google no contesta en esto, se corta y se usa el respaldo del registro. */
const TIMEOUT_MS = 8000;

/**
 * El nombre de la hoja lleva tilde y a veces no resuelve del lado de Google.
 * Si no resuelve, gviz devuelve la PRIMERA hoja del libro —la de respuestas
 * del formulario— sin avisar, y el parseo sale vacío o con basura. Por eso se
 * prueban variantes y gana la primera que traiga filas con nombre.
 */
function candidatos(sheetName: string): string[] {
  // \u0300-\u036f son las marcas diacríticas combinantes: "Análisis" → "Analisis".
  // Escritas con escape y no con el carácter literal, que en un diff es invisible.
  const sinTilde = sheetName.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return Array.from(new Set([
    sheetName,
    sinTilde,
    sheetName.toLowerCase(),
    sinTilde.toLowerCase(),
  ]));
}

function csvUrl(sheetId: string, hoja: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(hoja)}`;
}

/** Mismo parseo de comillas que usa el dashboard: los nombres pueden traer comas. */
function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let enComillas = false;
  for (const c of line) {
    if (c === '"') { enComillas = !enComillas; continue; }
    if (c === "," && !enComillas) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

export interface ResultadoEquipos {
  equipos: Equipo[];
  /** "planilla" si salieron del Sheet, "registro" si se usó el respaldo. */
  fuente: "planilla" | "registro";
  /** Por qué se cayó al respaldo, para que el operador lo vea y no lo adivine. */
  error?: string;
}

/**
 * Los equipos de una competición, leídos de su planilla.
 *
 * A diferencia del dashboard, acá se toma la fila con que tenga NOMBRE, aunque
 * el jurado todavía no la haya puntuado: los equipos existen antes de tener
 * nota, y el operador los necesita en el selector justamente antes de que
 * presenten.
 *
 * El proyecto no está en la planilla —es texto descriptivo— así que se cruza
 * por nombre con el registro. Si no hay coincidencia queda vacío y el operador
 * lo escribe en el campo de al lado, que siempre fue editable.
 */
export async function leerEquipos(comp: Competencia): Promise<ResultadoEquipos> {
  const respaldo: ResultadoEquipos = {
    equipos: comp.equipos,
    fuente: "registro",
  };

  if (!comp.sheetId) {
    return { ...respaldo, error: "La competición no tiene planilla configurada." };
  }

  const proyectoDe = new Map(
    comp.equipos.map((e) => [e.name.trim().toLowerCase(), e.project])
  );

  let ultimoError = "";

  for (const hoja of candidatos(comp.sheetName)) {
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${csvUrl(comp.sheetId, hoja)}&cachebust=${Date.now()}`, {
        signal: controlador.signal,
        cache: "no-store",
      });
      if (!res.ok) { ultimoError = `HTTP ${res.status} leyendo la hoja "${hoja}".`; continue; }

      const texto = await res.text();
      const lineas = texto.trim().split("\n").filter((l) => l.trim().length > 0);
      const equipos: Equipo[] = [];
      const vistos = new Set<string>();

      // Fila 0 = encabezado. col A = Equipo N°, col B = Nombre.
      for (let i = 1; i < lineas.length; i++) {
        const cols = parseCSVLine(lineas[i]);
        const nombre = (cols[1] || "").trim();
        if (!nombre || nombre.startsWith("#")) continue;
        const clave = nombre.toLowerCase();
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        equipos.push({ name: nombre, project: proyectoDe.get(clave) || "" });
      }

      if (equipos.length) return { equipos, fuente: "planilla" };
      ultimoError = `La hoja "${hoja}" no tiene equipos cargados en la columna B.`;
    } catch (e: any) {
      ultimoError = e?.name === "AbortError"
        ? "Google Sheets tardó demasiado en responder."
        : e?.message || "No se pudo leer la planilla.";
    } finally {
      clearTimeout(corte);
    }
  }

  return { ...respaldo, error: ultimoError };
}
