/**
 * Puerta de acceso al copiloto y a las APIs de escritura.
 *
 * Sin esto, cualquiera con la URL /copiloto podía escribir texto arbitrario en
 * la pantalla grande del evento.
 *
 * Usa Web Crypto (no `node:crypto`) porque el middleware corre en el runtime
 * Edge. El token de la cookie es SHA-256 de la contraseña: quien no la sepa no
 * puede fabricarlo, y la contraseña en sí nunca queda guardada en el navegador.
 */

export const AUTH_COOKIE = "eday_session";

/** Si no hay ADMIN_PASSWORD, el copiloto queda abierto (modo desarrollo). */
export function isAuthEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`eday-2026:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparación en tiempo constante, para no filtrar el token por timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  if (!cookieValue) return false;
  const expected = await sessionToken(process.env.ADMIN_PASSWORD as string);
  return safeEqual(cookieValue, expected);
}
