import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isAuthEnabled, isValidSession } from "@/lib/auth";

/**
 * Protege el panel del operador y todo lo que escribe en la pantalla pública.
 *
 * Queda abierto a propósito:
 *   - "/" y "/publico"   → son las pantallas de sala, tienen que ser públicas.
 *   - GET /api/fichas    → la pantalla pública lo consulta para recuperar estado.
 *   - /login, /api/auth  → si no, no habría forma de entrar.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  if (!isAuthEnabled()) return NextResponse.next();

  if (pathname.startsWith("/api/auth")) return NextResponse.next();
  if (pathname === "/api/fichas" && (method === "GET" || method === "HEAD")) {
    return NextResponse.next();
  }
  // El home necesita la key pública de Pusher para escuchar el canal. No es un
  // secreto: sólo permite suscribirse y oír; publicar requiere PUSHER_SECRET,
  // que nunca sale del servidor.
  if (pathname === "/api/pusher-config" && (method === "GET" || method === "HEAD")) {
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
  matcher: ["/copiloto/:path*", "/api/:path*"],
};
