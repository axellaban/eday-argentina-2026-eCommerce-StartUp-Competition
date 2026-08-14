import { NextResponse } from "next/server";
import { AUTH_COOKIE, isAuthEnabled, safeEqual, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Le dice a la UI si el copiloto está protegido, para poder avisar si no lo está. */
export async function GET() {
  return NextResponse.json({ enabled: isAuthEnabled() });
}

export async function POST(req: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ ok: true, enabled: false });
  }

  let password = "";
  try {
    const body = await req.json();
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const expected = await sessionToken(process.env.ADMIN_PASSWORD as string);
  const provided = await sessionToken(password);

  if (!safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, enabled: true });
  res.cookies.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 h: cubre una jornada de evento
  });
  return res;
}

/** Cerrar sesión. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
