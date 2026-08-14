import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { pusherServer } from "@/lib/pusher";

const DATA_DIR = path.join(process.cwd(), "data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

interface TeamSession {
  team: string;
  project: string;
  transcript: string;
  analysis?: string;
  metrics?: any;
  isFinished: boolean;
  timestamp: string;
  updatedAt: number;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: {}, activeTeam: null }, null, 2));
  }
}

function loadSessionsData(): { sessions: Record<string, TeamSession>; activeTeam: string | null } {
  try {
    ensureDataDir();
    const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { sessions: {}, activeTeam: null };
  }
}

function saveSessionsData(data: { sessions: Record<string, TeamSession>; activeTeam: string | null }) {
  try {
    ensureDataDir();
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error guardando sessions.json en disco:", e);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const team = searchParams.get("team");
  const data = loadSessionsData();

  if (team && data.sessions[team]) {
    return NextResponse.json(data.sessions[team]);
  }

  const finishedList = Object.values(data.sessions).filter(s => s.isFinished);
  const activeSession = data.activeTeam ? data.sessions[data.activeTeam] : null;

  return NextResponse.json({
    activeSession,
    finishedSessions: finishedList,
    allSessions: data.sessions
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, team, project, textChunk, analysis, metrics } = body;

    if (!team) {
      return NextResponse.json({ error: "Falta el nombre del equipo" }, { status: 400 });
    }

    const data = loadSessionsData();

    if (!data.sessions[team]) {
      data.sessions[team] = {
        team,
        project: project || "",
        transcript: "",
        isFinished: false,
        timestamp: new Date().toLocaleTimeString("es-AR"),
        updatedAt: Date.now()
      };
    }

    const session = data.sessions[team];
    data.activeTeam = team;

    if (project) session.project = project;

    if (textChunk) {
      session.transcript += (session.transcript ? " " : "") + textChunk;
      session.updatedAt = Date.now();
    }

    if (analysis) session.analysis = analysis;
    if (metrics) session.metrics = metrics;

    if (action === "finish") {
      session.isFinished = true;
      session.updatedAt = Date.now();
      data.activeTeam = null;

      // Broadcast finished pitch event to public viewers via Pusher
      try {
        await pusherServer.trigger("eday-pitch-channel", "finish-pitch", {
          team: session.team,
          project: session.project,
          transcript: session.transcript,
          analysis: session.analysis,
          metrics: session.metrics,
          timestamp: session.timestamp
        });
      } catch {}
    }

    saveSessionsData(data);

    return NextResponse.json({
      success: true,
      team,
      session
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Error al procesar la sesión del equipo" }, { status: 500 });
  }
}
