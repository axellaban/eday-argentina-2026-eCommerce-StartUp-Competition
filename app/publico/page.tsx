"use client";

import { useEffect, useState } from "react";
import PusherClient from "pusher-js";
import { INDICATORS, neutralMetrics } from "@/lib/criteria";
import { PUSHER_CHANNEL, PUSHER_CLUSTER, PUSHER_EVENTS, PUSHER_KEY } from "@/lib/pusher-config";

type Metrics = Record<string, number>;

interface TeamSession {
  team: string;
  project: string;
  transcript: string;
  analysis?: string;
  metrics?: Metrics;
  timestamp: string;
  isFinished?: boolean;
}

export default function PublicLiveViewerPage() {
  const [activePitch, setActivePitch] = useState<{ team: string; project: string } | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(neutralMetrics);
  const [finishedSessions, setFinishedSessions] = useState<TeamSession[]>([]);
  const [pusherConnected, setPusherConnected] = useState(false);
  const [configError, setConfigError] = useState("");

  // Initial load & recovery from server API
  const loadSavedData = async () => {
    try {
      const res = await fetch("/api/fichas");
      if (res.ok) {
        const data = await res.json();
        if (data.finishedSessions) {
          setFinishedSessions(data.finishedSessions);
        }
        if (data.activeSession && !data.activeSession.isFinished) {
          setActivePitch({ team: data.activeSession.team, project: data.activeSession.project });
          if (data.activeSession.transcript) {
            setLiveTranscript([data.activeSession.transcript]);
          }
          if (data.activeSession.metrics) {
            setMetrics(data.activeSession.metrics);
          }
        }
      }
    } catch (e) {
      console.error("Error al cargar sesiones del servidor:", e);
    }
  };

  useEffect(() => {
    loadSavedData();

    if (!PUSHER_KEY) {
      setConfigError(
        "Falta NEXT_PUBLIC_PUSHER_KEY: la pantalla no va a recibir el pitch en vivo."
      );
      return;
    }

    const pusher = new PusherClient(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      forceTLS: true,
    });

    pusher.connection.bind("connected", () => setPusherConnected(true));
    pusher.connection.bind("disconnected", () => setPusherConnected(false));
    pusher.connection.bind("error", () =>
      setConfigError("No se pudo conectar al canal en tiempo real.")
    );

    const channel = pusher.subscribe(PUSHER_CHANNEL);

    // Listen for live speech transcript chunks
    channel.bind(
      PUSHER_EVENTS.transcript,
      (data: { team: string; project: string; textChunk: string }) => {
        setActivePitch({ team: data.team, project: data.project });
        setLiveTranscript((prev) => [...prev, data.textChunk]);
      }
    );

    // Listen for live LLM metric shifts (0-100%, 50% is neutral middle)
    channel.bind(PUSHER_EVENTS.metrics, (data: { team: string; metrics: Metrics }) => {
      if (data.metrics) {
        setMetrics(data.metrics);
      }
    });

    // Listen for finished pitch events
    channel.bind(PUSHER_EVENTS.finish, (data: TeamSession) => {
      setFinishedSessions((prev) => [data, ...prev.filter((s) => s.team !== data.team)]);
      setActivePitch(null);
      setLiveTranscript([]);
      setMetrics(neutralMetrics());
    });

    return () => {
      pusher.unsubscribe(PUSHER_CHANNEL);
      // Sin disconnect() el socket queda abierto entre remontajes.
      pusher.disconnect();
    };
  }, []);

  const getMetricColor = (value: number) => {
    if (value > 65) return "#22C55E";
    if (value > 45) return "#00A8FF";
    if (value > 30) return "#F6B40E";
    return "#EF4444";
  };

  const getMetricStatus = (value: number) => {
    if (value > 65) return "Alto";
    if (value > 55) return "Favorable";
    if (value >= 45) return "Neutro";
    if (value > 30) return "En Observación";
    return "Bajo";
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #011929 0%, #022840 50%, #063454 100%)", color: "#FFFFFF", padding: "24px 16px" }}>
      
      {/* Background Orbs */}
      <div className="ambient-orb orb-1"></div>
      <div className="ambient-orb orb-2"></div>

      <div style={{ maxWidth: "1250px", margin: "0 auto", position: "relative", zIndex: 10 }}>
        
        {/* Header */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px", background: "rgba(7, 36, 61, 0.85)", padding: "18px 26px", borderRadius: "16px", border: "1px solid rgba(0, 168, 255, 0.25)", marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <img src="/logos argentina/PNG/SIN BAJADA/02.png" alt="eCommerce DAY Argentina" style={{ height: "36px", width: "auto" }} />
            <div style={{ borderLeft: "1px solid rgba(69, 119, 178, 0.3)", paddingLeft: "14px" }}>
              <div style={{ fontSize: "1.3rem", fontWeight: 900 }}>Pantalla Pública · Demo Day</div>
              <div style={{ fontSize: "0.75rem", color: "#D5DCF2", opacity: 0.8 }}>eCommerce StartUp Competition Argentina 2026</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button onClick={loadSavedData} style={{ padding: "6px 12px", borderRadius: "10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(69, 119, 178, 0.3)", color: "#D5DCF2", fontSize: "0.75rem", cursor: "pointer" }}>
              ↻ Sincronizar Fichas
            </button>

            {(() => {
              const color = configError ? "#EF4444" : pusherConnected ? "#22C55E" : "#F6B40E";
              const label = configError
                ? "SIN CANAL"
                : pusherConnected
                ? "CANAL REALTIME ACTIVO"
                : "RECONECTANDO...";
              return (
                <div
                  title={configError || undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: `${color}1A`,
                    border: `1px solid ${color}55`,
                    padding: "6px 14px",
                    borderRadius: "999px",
                  }}
                >
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }}></div>
                  <span style={{ fontSize: "0.75rem", fontWeight: 700, color, fontFamily: "monospace" }}>
                    {label}
                  </span>
                </div>
              );
            })()}
          </div>
        </header>

        {/* Live Pitch Transcript Container */}
        <div style={{ background: "rgba(7, 36, 61, 0.8)", border: "1px solid rgba(0, 168, 255, 0.3)", borderRadius: "20px", padding: "28px", backdropFilter: "blur(20px)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", marginBottom: "28px" }}>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid rgba(69, 119, 178, 0.25)", paddingBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "#00A8FF", letterSpacing: "0.1em" }}>🔴 PRESENTACIÓN EN VIVO</div>
              <h2 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#FFFFFF", marginTop: "4px" }}>
                {activePitch ? activePitch.team : "Esperando inicio de exposición..."}
              </h2>
              {activePitch && <div style={{ fontSize: "0.85rem", color: "#859CC2", marginTop: "2px" }}>{activePitch.project}</div>}
            </div>

            {activePitch && (
              <span style={{ padding: "6px 16px", borderRadius: "999px", background: "rgba(0,168,255,0.15)", border: "1px solid rgba(0,168,255,0.35)", color: "#00A8FF", fontWeight: 700, fontSize: "0.8rem", fontFamily: "monospace" }}>
                TRANSMITIENDO PITCH
              </span>
            )}
          </div>

          {/* Subtítulos / Transcript en vivo */}
          <div style={{ minHeight: "200px", maxHeight: "320px", overflowY: "auto", background: "rgba(1, 25, 41, 0.6)", borderRadius: "14px", padding: "20px", border: "1px solid rgba(69, 119, 178, 0.2)", fontSize: "1.1rem", lineHeight: "1.8", color: "#D5DCF2" }}>
            {liveTranscript.length === 0 ? (
              <div style={{ textAlign: "center", color: "#859CC2", fontStyle: "italic", marginTop: "60px" }}>
                Las palabras del orador aparecerán aquí en vivo al iniciar la presentación.
              </div>
            ) : (
              liveTranscript.map((chunk, idx) => (
                <span key={idx} style={{ color: "#FFFFFF", marginRight: "6px" }}>
                  {chunk}
                </span>
              ))
            )}
          </div>

        </div>

        {/* ══ INDICADORES DINÁMICOS EN TIEMPO REAL ══ */}
        <div style={{ background: "rgba(7, 36, 61, 0.8)", border: "1px solid rgba(69, 119, 178, 0.3)", borderRadius: "20px", padding: "28px", backdropFilter: "blur(20px)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", marginBottom: "32px" }}>
          
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid rgba(69, 119, 178, 0.25)", paddingBottom: "14px" }}>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", color: "#00A8FF", letterSpacing: "0.12em", fontFamily: "monospace" }}>📊 ANÁLISIS DINÁMICO EN VIVO</div>
              <h3 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#FFFFFF", marginTop: "2px" }}>Indicadores del Equipo Activo</h3>
            </div>
            <div style={{ fontSize: "0.72rem", color: "#859CC2", fontFamily: "monospace" }}>Punto medio inicial: 50%</div>
          </div>

          {/* Grid de 6 Indicadores */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
            {INDICATORS.map((ind) => {
              const val = (metrics as any)[ind.key] ?? 50;
              const color = getMetricColor(val);
              const statusText = getMetricStatus(val);

              return (
                <div
                  key={ind.key}
                  style={{
                    background: "rgba(2, 40, 64, 0.7)",
                    borderRadius: "14px",
                    padding: "18px 20px",
                    border: "1px solid rgba(69, 119, 178, 0.25)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "0.92rem", color: "#FFFFFF" }}>
                      <span>{ind.icon}</span>
                      <span>{ind.label}</span>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: "1.1rem", fontWeight: 800, color: color, fontFamily: "monospace" }}>
                        {val}%
                      </span>
                      <span style={{ display: "block", fontSize: "0.68rem", fontWeight: 700, color: "#859CC2", textTransform: "uppercase" }}>
                        {statusText}
                      </span>
                    </div>
                  </div>

                  {/* Meter Track Container */}
                  <div style={{ position: "relative", height: "12px", background: "rgba(255,255,255,0.06)", borderRadius: "999px", overflow: "hidden", border: "1px solid rgba(69, 119, 178, 0.2)" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "2px", background: "rgba(255,255,255,0.3)", zIndex: 5 }}></div>
                    <div
                      style={{
                        height: "100%",
                        width: `${val}%`,
                        background: `linear-gradient(90deg, #00A8FF 0%, ${color} 100%)`,
                        borderRadius: "999px",
                        transition: "width 1s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        boxShadow: `0 0 12px ${color}66`
                      }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ══ FICHAS REGISTRADAS / HISTORIAL PERSISTENTE DE LA COMPETENCIA ══ */}
        <div style={{ background: "rgba(7, 36, 61, 0.8)", border: "1px solid rgba(69, 119, 178, 0.3)", borderRadius: "20px", padding: "28px", backdropFilter: "blur(20px)", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", borderBottom: "1px solid rgba(69, 119, 178, 0.25)", paddingBottom: "16px" }}>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", color: "#22C55E", letterSpacing: "0.12em", fontFamily: "monospace" }}>📜 FICHAS FINALIZADAS Y GUARDADAS</div>
              <h3 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#FFFFFF", marginTop: "2px" }}>Historial de Equipos Presentados ({finishedSessions.length})</h3>
            </div>
          </div>

          {finishedSessions.length === 0 ? (
            <div style={{ textAlign: "center", color: "#859CC2", fontStyle: "italic", padding: "40px 0" }}>
              Las fichas registradas de cada equipo aparecerán aquí a medida que finalicen su exposición.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {finishedSessions.map((session, idx) => (
                <div key={idx} style={{ background: "rgba(2, 40, 64, 0.75)", border: "1px solid rgba(0, 168, 255, 0.3)", borderRadius: "16px", padding: "24px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                    <div>
                      <span style={{ fontSize: "0.7rem", fontWeight: 800, color: "#22C55E", textTransform: "uppercase", fontFamily: "monospace" }}>✓ PITCH FINALIZADO · {session.timestamp}</span>
                      <h4 style={{ fontSize: "1.3rem", fontWeight: 800, color: "#FFFFFF", marginTop: "2px" }}>{session.team}</h4>
                      <div style={{ fontSize: "0.85rem", color: "#859CC2" }}>{session.project}</div>
                    </div>
                  </div>

                  {/* Transcripción completa del equipo */}
                  <div style={{ background: "rgba(1, 25, 41, 0.6)", borderRadius: "12px", padding: "16px", fontSize: "0.88rem", lineHeight: "1.6", color: "#D5DCF2", marginBottom: "16px", maxHeight: "180px", overflowY: "auto", border: "1px solid rgba(69, 119, 178, 0.2)" }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#859CC2", textTransform: "uppercase", marginBottom: "6px" }}>TRANSCRIPCIÓN COMPLETA DE LA PRESENTACIÓN:</div>
                    {session.transcript}
                  </div>

                  {/* Análisis de la IA */}
                  {session.analysis && (
                    <div style={{ background: "rgba(0, 168, 255, 0.08)", border: "1px solid rgba(0, 168, 255, 0.25)", borderRadius: "12px", padding: "16px", fontSize: "0.88rem", lineHeight: "1.6", color: "#FFFFFF", whiteSpace: "pre-wrap" }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#00A8FF", textTransform: "uppercase", marginBottom: "6px" }}>💡 EVALUACIÓN Y NOTAS DE LA IA:</div>
                      {session.analysis}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
