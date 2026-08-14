import { NextResponse } from "next/server";
import { broadcast } from "@/lib/pusher";
import { PUSHER_EVENTS } from "@/lib/pusher-config";

export const dynamic = "force-dynamic";

/**
 * Empuja texto a la pantalla pública.
 *
 * mode "append" (default): una frase suelta, para que aparezca al instante.
 * mode "sync": el transcript completo acumulado, que reemplaza lo que haya.
 *   Es la red de seguridad contra eventos perdidos y contra viewers que
 *   abrieron la pantalla a mitad del pitch.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { team, project, textChunk, fullText, isFinal, mode } = body;

    const esSync = mode === "sync";
    const contenido = esSync ? fullText : textChunk;

    if (!team || typeof contenido !== "string") {
      return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
    }

    const result = await broadcast(esSync ? PUSHER_EVENTS.sync : PUSHER_EVENTS.transcript, {
      team,
      project,
      ...(esSync ? { fullText: contenido } : { textChunk: contenido, isFinal: !!isFinal }),
      timestamp: new Date().toLocaleTimeString("es-AR"),
    });

    if (!result.ok) {
      // 503: el pitch sigue, pero la pantalla pública no está recibiendo nada.
      // El copiloto muestra este error en pantalla en vez de tragárselo.
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json({ success: true, team, mode: esSync ? "sync" : "append" });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error transmitiendo evento Pusher" },
      { status: 500 }
    );
  }
}
