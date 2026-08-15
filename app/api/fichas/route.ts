import { NextResponse } from "next/server";
import { broadcast } from "@/lib/pusher";
import { PUSHER_EVENTS } from "@/lib/pusher-config";
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
    const { action, team, project, textChunk, analysis, analysisError, metrics } = body;

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
        transcript: session.transcript,
        analysis: session.analysis,
        analysisError: session.analysisError,
        metrics: session.metrics,
        timestamp: session.timestamp,
        isFinished: true,
      });
      if (!result.ok) broadcastError = result.error;
    } else {
      session.isFinished = false;
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
