import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthEnabled, isValidSession } from "@/lib/auth";

/**
 * Protege el panel del operador y todo lo que escribe en la pantalla del evento.
 *
 * Queda abierto a propósito:
 *   - "/" y "/{competencia}" y "/{competencia}/ai" → son las pantallas de
 *     sala y el dashboard público: tienen que ser públicas.
 *   - GET /api/fichas    → el dashboard lo consulta para recuperar estado.
 *   - GET /api/config    → el dashboard es HTML estático y necesita su
 *     competición, el canal y los criterios antes de poder dibujar nada.
 *   - /login, /api/auth  → si no, no habría forma de entrar.
 *
 * Una sola contraseña para las dos competiciones: las opera la misma persona,
 * una después de la otra. Si alguna vez las opera gente distinta, esto pasa a
 * ser una contraseña por competición leída del registro.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  if (!isAuthEnabled()) return NextResponse.next();

  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (pathname === "/api/fichas" && (method === "GET" || method === "HEAD")) {
    return NextResponse.next();
  }
  // El dashboard necesita su config: la key pública de Pusher, los criterios
  // y la planilla. Nada de eso es secreto —la key sólo permite suscribirse y
  // oír; publicar requiere PUSHER_SECRET, que nunca sale del servidor— y sin
  // esto el HTML estático no tiene forma de saber qué competición es.
  if (pathname === "/api/config" && (method === "GET" || method === "HEAD")) {
    return NextResponse.next();
  }

  const ok = await isValidSession(req.cookies.get(AUTH_COOKIE)?.value);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "No autorizado. Iniciá sesión en /login para operar el copiloto." },
      { status: 401 }
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * El copiloto ahora vive bajo la competición: /{competencia}/copiloto.
   *
   * El patrón tiene que cubrir esa forma, no "/copiloto": si quedara el viejo,
   * el panel del operador de las dos competiciones estaría abierto a
   * cualquiera con la URL — que es exactamente el agujero que este middleware
   * existe para tapar.
   */
  matcher: ["/:competencia/copiloto/:path*", "/api/:path*"],
};
