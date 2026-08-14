import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Devuelve un token efímero de Deepgram para que el navegador abra el WebSocket.
 *
 * IMPORTANTE: nunca devolver DEEPGRAM_API_KEY al cliente. La versión anterior
 * tenía un fallback que, si /auth/grant fallaba, mandaba la key maestra en texto
 * plano al navegador — cualquiera que hiciera POST acá se la llevaba. Si el
 * grant falla, ahora fallamos.
 */
export async function POST() {
  const rawKey = process.env.DEEPGRAM_API_KEY;
  if (!rawKey) {
    return NextResponse.json(
      { error: "Falta DEEPGRAM_API_KEY en las variables de entorno." },
      { status: 500 }
    );
  }
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");

  try {
    const r = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      // 300s: el token sólo se usa para abrir la conexión, pero un margen mayor
      // evita fallar si el operador tarda en dar permiso al micrófono.
      body: JSON.stringify({ ttl_seconds: 300 }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return NextResponse.json(
        {
          error: "Deepgram rechazó la solicitud de token efímero.",
          detail: detail.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const j: any = await r.json().catch(() => ({}));
    const token = j.access_token;

    if (!token) {
      return NextResponse.json(
        { error: "Deepgram no devolvió un token efímero válido." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      token,
      scheme: "bearer",
      expires_in: j.expires_in ?? 300,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "No se pudo contactar a Deepgram." },
      { status: 502 }
    );
  }
}
