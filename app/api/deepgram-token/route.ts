import { NextResponse } from "next/server";

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
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    if (r.ok) {
      const j: any = await r.json().catch(() => ({}));
      const token = j.access_token || j.key;
      if (token) {
        return NextResponse.json({ token, scheme: "bearer", expires_in: j.expires_in ?? 60 });
      }
    }
  } catch {}

  return NextResponse.json({ token: apiKey, scheme: "token", fallback: true });
}
