/**
 * Traduce un error de la API de Gemini a algo que se pueda leer en pantalla
 * durante el evento.
 *
 * Google devuelve el motivo real anidado en `error.message`, dentro de un
 * cuerpo JSON. Las rutas mostraban sólo "Error en Gemini API" y tiraban ese
 * cuerpo a un campo `detail` que la UI ni siquiera pintaba, así que el
 * operador veía un cartel genérico y no había forma de distinguir una API key
 * mal cargada de una cuota agotada — que se arreglan de maneras muy distintas
 * y con el equipo ya arriba del escenario.
 */
export function motivoGemini(status: number, cuerpo: string): string {
  let mensaje = "";
  try {
    mensaje = JSON.parse(cuerpo)?.error?.message || "";
  } catch {
    mensaje = cuerpo.slice(0, 200);
  }
  mensaje = mensaje.trim();

  // Los tres casos que realmente pasan, con la acción concreta al lado.
  if (status === 429) {
    return `Gemini rechazó por límite de uso (429). ${mensaje || "Se agotó la cuota del plan."} → revisá cuota y facturación en Google AI Studio.`;
  }
  if (status === 400 && /api[_ ]?key/i.test(mensaje)) {
    return `Gemini rechazó la API key (400). ${mensaje} → revisá GEMINI_API_KEY en Vercel.`;
  }
  if (status === 403) {
    return `Gemini denegó el acceso (403). ${mensaje || "La key no tiene permiso para este modelo."}`;
  }
  if (status === 404) {
    return `Gemini no encontró el modelo (404). ${mensaje || ""} → ese modelo dejó de existir para esta key; se vuelve a resolver solo en la próxima llamada.`;
  }
  return `Error de Gemini (${status})${mensaje ? `: ${mensaje}` : ""}`;
}
