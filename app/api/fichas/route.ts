import { NextResponse } from "next/server";
import { broadcast } from "@/lib/pusher";
import { MAX_TRANSCRIPT_EVENTO, PUSHER_EVENTS } from "@/lib/pusher-config";
import { loadSessions, saveSessions, isDurable, TeamSession } from "@/lib/store";

// El estado cambia en cada pitch: nunca cachear esta ruta.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const team = searchParams.get("team");
  const data = await loadSessions();

  if (team) {
    const session = data.sessions[team];
    if (!session) {
      return NextResponse.json({ error: "Equipo no encontrado" }, { status: 404 });
    }
    return NextResponse.json(session);
  }

  const finishedList = Object.values(data.sessions)
    .filter((s) => s.isFinished)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const activeSession = data.activeTeam ? data.sessions[data.activeTeam] : null;

  return NextResponse.json({
    activeSession,
    finishedSessions: finishedList,
    allSessions: data.sessions,
    durable: isDurable(),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, team, project, textChunk, fullText, analysis, analysisError, metrics, lecturas, preguntas } = body;

    if (!team) {
      return NextResponse.json({ error: "Falta el nombre del equipo" }, { status: 400 });
    }

    const data = await loadSessions();

    if (!data.sessions[team]) {
      const nueva: TeamSession = {
        team,
        project: project || "",
        transcript: "",
        isFinished: false,
        timestamp: new Date().toLocaleTimeString("es-AR"),
        updatedAt: Date.now(),
      };
      data.sessions[team] = nueva;
    }

    const session = data.sessions[team];

    if (project) session.project = project;

    if (textChunk) {
      session.transcript += (session.transcript ? " " : "") + textChunk;
      session.updatedAt = Date.now();
    }

    /**
     * Reparación del transcript.
     *
     * Los chunks llegan uno por uno y si un POST se pierde por un parpadeo de
     * red, ese pedazo faltaba en el servidor para siempre: no había forma de
     * recuperarlo. Cada tanto el copiloto manda el texto completo que tiene
     * acumulado y, si es más largo que lo guardado, lo reemplaza. Cualquier
     * hueco se tapa solo en el próximo ciclo.
     */
    if (typeof fullText === "string" && fullText.length > session.transcript.length) {
      session.transcript = fullText;
      session.updatedAt = Date.now();
    }

    if (typeof lecturas === "number") session.lecturas = lecturas;

    /**
     * La lista viene ya depurada por /api/highlights (saca las respondidas,
     * suma de a dos, tope de seis). Acá sólo se guarda, con un tope duro por
     * las dudas: es lo único que el home va a leer.
     */
    if (Array.isArray(preguntas)) {
      session.preguntas = preguntas
        .map((p: unknown) => String(p || "").trim())
        .filter(Boolean)
        .slice(0, 6);
    }

    if (analysis) session.analysis = analysis;
    if (analysisError !== undefined) session.analysisError = analysisError;
    if (metrics) session.metrics = metrics;

    let broadcastError: string | null = null;

    if (action === "finish") {
      session.isFinished = true;
      session.updatedAt = Date.now();
      data.activeTeam = null;

      const result = await broadcast(PUSHER_EVENTS.finish, {
        team: session.team,
        project: session.project,
        // Sólo la cola: el evento entero no puede pasar los 10 KB de Pusher.
        transcript: session.transcript.slice(-MAX_TRANSCRIPT_EVENTO),
        transcriptLargo: session.transcript.length,
        analysis: session.analysis,
        analysisError: session.analysisError,
        metrics: session.metrics,
        timestamp: session.timestamp,
        isFinished: true,
      });
      if (!result.ok) broadcastError = result.error;
    } else {
      session.isFinished = false;

      // Si había otro equipo activo, quedó sin cerrar: el operador pasó al
      // siguiente sin tocar "Finalizar". Se cierra solo para que su
      // transcripción no quede huérfana y aparezca en el historial.
      if (data.activeTeam && data.activeTeam !== team && data.sessions[data.activeTeam]) {
        const anterior = data.sessions[data.activeTeam];
        anterior.isFinished = true;
        anterior.updatedAt = Date.now();
        if (!anterior.analysis && !anterior.analysisError) {
          anterior.analysisError =
            "El pitch se cerró automáticamente al empezar el equipo siguiente, sin generar ficha.";
        }
      }

      data.activeTeam = team;
    }

    await saveSessions(data);

    return NextResponse.json({
      success: true,
      team,
      session,
      durable: isDurable(),
      broadcastError,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error al procesar la sesión del equipo" },
      { status: 500 }
    );
  }
}
