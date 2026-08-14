import { NextResponse } from "next/server";
import { broadcast } from "@/lib/pusher";
import { PUSHER_EVENTS } from "@/lib/pusher-config";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { team, project, textChunk, isFinal } = body;

    if (!team || !textChunk) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const result = await broadcast(PUSHER_EVENTS.transcript, {
      team,
      project,
      textChunk,
      isFinal: !!isFinal,
      timestamp: new Date().toLocaleTimeString("es-AR"),
    });

    if (!result.ok) {
      // 503: el pitch sigue, pero la pantalla pública no está recibiendo nada.
      // El copiloto muestra este error en pantalla en vez de tragárselo.
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json({ success: true, team, broadcastedText: textChunk });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error transmitiendo evento Pusher" },
      { status: 500 }
    );
  }
}
