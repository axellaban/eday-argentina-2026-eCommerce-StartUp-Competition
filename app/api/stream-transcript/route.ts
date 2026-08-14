import { NextResponse } from "next/server";
import { pusherServer } from "@/lib/pusher";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { team, project, textChunk, isFinal } = body;

    if (!team || !textChunk) {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    // Trigger instant Pusher broadcast event to all public viewers
    await pusherServer.trigger("eday-pitch-channel", "live-transcript", {
      team,
      project,
      textChunk,
      isFinal: !!isFinal,
      timestamp: new Date().toLocaleTimeString("es-AR")
    });

    return NextResponse.json({ success: true, team, broadcastedText: textChunk });

  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error transmitiendo evento Pusher" }, { status: 500 });
  }
}
