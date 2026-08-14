"use client";

import { useState, useEffect, useRef } from "react";

const TEAMS_DEFAULT = [
  { name: "Ceci Escudero", project: "Pipeline de 4 Agentes para Generación de Contenido LinkedIn (GIT)" },
  { name: "Maria Cecilia", project: "Asesor Financiero Agéntico con Reportes Semanales por Telegram" },
  { name: "Maru Portela", project: "GrowthThing — Sistema Multi-Agente de Prospecting B2B (NanoThing)" },
  { name: "Debora Menigali", project: "Colaboratech — Gestión del Conocimiento con IA (Droguería del Sur)" },
  { name: "Oscar", project: "Marketing Studio — Plataforma Agéntica Multimarca (Agencia de Marketing)" },
  { name: "Valentin", project: "Agente Postventa 24/7 por WhatsApp — Sueño Dorado Colchones" },
  { name: "Carol Lamoza", project: "Evaluador Inteligente de Licitaciones Públicas — Mercado Público (Chile)" },
  { name: "Agus Vidal", project: "CacheViti 2.0 — Consolidación Agéntica de Carteras Multi-Banco" },
  { name: "Alessandra", project: "Sistema Editorial de 2 Agentes — Libro de Bitex (Content Lab eCI)" }
];

export default function CopilotoStandalonePage() {
  const [step, setStep] = useState<"setup" | "live" | "session">("setup");
  const [selectedTeam, setSelectedTeam] = useState(TEAMS_DEFAULT[0].name);
  const [customTeam, setCustomTeam] = useState("");
  const [projectName, setProjectName] = useState(TEAMS_DEFAULT[0].project);
  
  // Real-time transcript state
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [interimText, setInterimText] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [savedSessions, setSavedSessions] = useState<any[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Update project name when selecting a default team
  useEffect(() => {
    const found = TEAMS_DEFAULT.find(t => t.name === selectedTeam);
    if (found) {
      setProjectName(found.project);
    }
  }, [selectedTeam]);

  const activeTeamName = customTeam.trim() || selectedTeam;

  // Start live evaluation session
  const startSession = () => {
    setStep("live");
    setTranscript([]);
    setAiAnalysis("");
  };

  // Toggle Deepgram audio recording
  const toggleRecording = async () => {
    if (isRecording) {
      if (socketRef.current) {
        try { socketRef.current.close(); } catch {}
      }
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      setIsRecording(false);
    } else {
      try {
        const tokenRes = await fetch("/api/deepgram-token", { method: "POST" });
        const tokenData = await tokenRes.json();

        if (!tokenRes.ok || !tokenData.token) {
          alert("Error conectando con el servicio de transcripción (Deepgram token error).");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        let mimeType = "audio/webm";
        if (typeof MediaRecorder !== "undefined") {
          if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
            mimeType = "audio/webm;codecs=opus";
          } else if (MediaRecorder.isTypeSupported("audio/webm")) {
            mimeType = "audio/webm";
          } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
            mimeType = "audio/mp4";
          }
        }

        const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true&punctuate=true&interim_results=true`;
        const socket = new WebSocket(wsUrl, ["token", tokenData.token]);

        socket.onopen = () => {
          console.log("Deepgram WebSocket conectado exitosamente.");
          const mediaRecorder = new MediaRecorder(stream, { mimeType });
          mediaRecorder.addEventListener("dataavailable", (event) => {
            if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              socket.send(event.data);
            }
          });
          mediaRecorder.start(250);
          mediaRecorderRef.current = mediaRecorder;
        };

        socket.onmessage = (message) => {
          const received = JSON.parse(message.data);
          const transcriptText = received.channel?.alternatives?.[0]?.transcript;

          if (transcriptText) {
            if (received.is_final) {
              setTranscript(prev => [...prev, transcriptText]);
              setInterimText("");

              fetch("/api/fichas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  team: activeTeamName,
                  project: projectName,
                  textChunk: transcriptText
                })
              }).catch(() => {});

              // Stream live transcript to public audience via Pusher WebSockets
              fetch("/api/stream-transcript", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  team: activeTeamName,
                  project: projectName,
                  textChunk: transcriptText,
                  isFinal: true
                })
              }).catch(() => {});
            } else {
              setInterimText(transcriptText);
            }
          }
        };

        socket.onerror = (err) => {
          console.error("Deepgram WS Error:", err);
        };

        socket.onclose = (evt) => {
          console.log("Deepgram WS Cerrado:", evt.code, evt.reason);
          setIsRecording(false);
        };

        socketRef.current = socket;
        setIsRecording(true);

      } catch (err: any) {
        console.error("Error al iniciar grabación:", err);
        alert("Error al iniciar audio: " + (err.message || err.toString()));
      }
    }
  };

  // Analyze current presentation pitch using Gemini AI & stream live metrics
  const analyzePitch = async () => {
    setIsAnalyzing(true);
    try {
      const fullText = transcript.join(" ") + " " + interimText;
      
      // Call Gemini for structured pitch analysis
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team: activeTeamName,
          project: projectName,
          transcript: fullText,
          question: "Evaluar presentación del equipo y sugerir notas"
        })
      });
      const data = await res.json();
      setAiAnalysis(data.text || data.error || "Análisis completado.");

      // Also calculate & stream live 6-indicator metrics to public audience
      fetch("/api/eval-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team: activeTeamName,
          project: projectName,
          transcript: fullText
        })
      }).catch(() => {});

    } catch (e: any) {
      setAiAnalysis("Error en la conexión con la IA de evaluación.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Save session and finish
  const finishSession = async () => {
    const fullTranscript = transcript.join(" ") + (interimText ? " " + interimText : "");

    try {
      await fetch("/api/fichas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          team: activeTeamName,
          project: projectName,
          textChunk: interimText,
          analysis: aiAnalysis
        })
      });
    } catch (e) {
      console.error("Error al finalizar ficha:", e);
    }

    if (isRecording) toggleRecording();
    setStep("session");
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #011929 0%, #022840 50%, #063454 100%)", color: "#FFFFFF", padding: "20px" }}>
      
      {/* Background Orbs */}
      <div className="ambient-orb orb-1"></div>
      <div className="ambient-orb orb-2"></div>

      {/* Header Bar */}
      <header className="copiloto-header" style={{ maxWidth: "1200px", margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px", background: "rgba(7, 36, 61, 0.85)", padding: "16px 24px", borderRadius: "16px", border: "1px solid rgba(0, 168, 255, 0.25)", position: "relative", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <img src="/logos argentina/PNG/SIN BAJADA/02.png" alt="eCommerce DAY Argentina" style={{ height: "36px", width: "auto" }} />
          <div style={{ borderLeft: "1px solid rgba(69, 119, 178, 0.3)", paddingLeft: "14px" }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>Copiloto de Evaluación en Vivo</div>
            <div style={{ fontSize: "0.72rem", color: "#D5DCF2", opacity: 0.8 }}>eCommerce StartUp Competition · Argentina 2026 (Local Standalone)</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          <span style={{ fontSize: "0.75rem", padding: "6px 12px", borderRadius: "999px", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#22C55E", fontWeight: 700, fontFamily: "monospace" }}>
            ● ENTORNOS ISLADOS (LOCAL)
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: "1200px", margin: "0 auto", position: "relative", zIndex: 10 }}>
        
        {/* STEP 1: SETUP SCREEN */}
        {step === "setup" && (
          <div style={{ background: "rgba(7, 36, 61, 0.75)", border: "1px solid rgba(69, 119, 178, 0.28)", borderRadius: "20px", padding: "32px", backdropFilter: "blur(20px)" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "8px", color: "#00A8FF" }}>Configurar Presentación de Pitch</h2>
            <p style={{ fontSize: "0.88rem", color: "#D5DCF2", marginBottom: "24px" }}>Seleccioná el equipo que va a presentar para iniciar la evaluación asistida por IA y transcripción en vivo.</p>

            <div className="setup-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "24px" }}>
              {/* Equipo Selector */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", color: "#859CC2", marginBottom: "8px" }}>Equipo que Presenta</label>
                <select
                  value={selectedTeam}
                  onChange={(e) => { setSelectedTeam(e.target.value); setCustomTeam(""); }}
                  style={{ width: "100%", padding: "12px 16px", borderRadius: "12px", background: "#0B3552", border: "1px solid rgba(0, 168, 255, 0.3)", color: "#FFFFFF", fontSize: "0.95rem", fontWeight: 600, outline: "none" }}
                >
                  {TEAMS_DEFAULT.map(t => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>

                <div style={{ marginTop: "12px" }}>
                  <input
                    type="text"
                    placeholder="O ingresá un nuevo nombre de equipo..."
                    value={customTeam}
                    onChange={(e) => setCustomTeam(e.target.value)}
                    style={{ width: "100%", padding: "12px 16px", borderRadius: "12px", background: "#0B3552", border: "1px solid rgba(69, 119, 178, 0.3)", color: "#FFFFFF", fontSize: "0.85rem", outline: "none" }}
                  />
                </div>
              </div>

              {/* Nombre del Proyecto */}
              <div>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", color: "#859CC2", marginBottom: "8px" }}>Nombre del Proyecto / Solución</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  style={{ width: "100%", padding: "12px 16px", borderRadius: "12px", background: "#0B3552", border: "1px solid rgba(0, 168, 255, 0.3)", color: "#FFFFFF", fontSize: "0.95rem", fontWeight: 600, outline: "none" }}
                />
              </div>
            </div>

            {/* Criterios de Evaluación */}
            <div style={{ background: "rgba(2, 40, 64, 0.6)", borderRadius: "14px", padding: "20px", border: "1px solid rgba(69, 119, 178, 0.2)", marginBottom: "28px" }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, textTransform: "uppercase", color: "#00A8FF", marginBottom: "12px" }}>Criterios de Evaluación de la Competencia (0 a 5 pts)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", fontSize: "0.8rem", color: "#D5DCF2" }}>
                <div style={{ background: "rgba(255,255,255,0.04)", padding: "10px", borderRadius: "8px" }}>⚡ <strong>Funciona en Vivo</strong></div>
                <div style={{ background: "rgba(255,255,255,0.04)", padding: "10px", borderRadius: "8px" }}>🧠 <strong>Arq. Agéntica</strong></div>
                <div style={{ background: "rgba(255,255,255,0.04)", padding: "10px", borderRadius: "8px" }}>🎯 <strong>Caso de Uso</strong></div>
                <div style={{ background: "rgba(255,255,255,0.04)", padding: "10px", borderRadius: "8px" }}>📊 <strong>Impacto Medible</strong></div>
                <div style={{ background: "rgba(255,255,255,0.04)", padding: "10px", borderRadius: "8px" }}>💡 <strong>¿Me lo Robo?</strong></div>
              </div>
            </div>

            <button
              onClick={startSession}
              style={{ width: "100%", padding: "16px", borderRadius: "14px", background: "linear-gradient(135deg, #00A8FF, #18A0D8)", color: "#FFFFFF", fontSize: "1rem", fontWeight: 800, border: "none", boxShadow: "0 4px 20px rgba(0, 168, 255, 0.35)", cursor: "pointer" }}
            >
              🎙️ Iniciar Evaluación & Transcripción de {activeTeamName}
            </button>
          </div>
        )}

        {/* STEP 2: LIVE TRANSCRIPTION & COPILOT EVALUATOR */}
        {step === "live" && (
          <div className="live-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            {/* Left Panel: Real-time Speech-to-Text */}
            <div className="live-panel" style={{ background: "rgba(7, 36, 61, 0.75)", border: "1px solid rgba(69, 119, 178, 0.28)", borderRadius: "20px", padding: "24px", backdropFilter: "blur(20px)", display: "flex", flexDirection: "column", minHeight: "60vh" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#FFFFFF" }}>{activeTeamName}</h3>
                  <div style={{ fontSize: "0.76rem", color: "#859CC2" }}>{projectName}</div>
                </div>

                <button
                  onClick={toggleRecording}
                  style={{
                    padding: "10px 18px", borderRadius: "12px",
                    background: isRecording ? "#EF4444" : "#22C55E",
                    color: "#FFFFFF", fontWeight: 700, fontSize: "0.85rem", border: "none",
                    boxShadow: isRecording ? "0 0 15px rgba(239, 68, 68, 0.4)" : "0 0 15px rgba(34, 197, 94, 0.4)"
                  }}
                >
                  {isRecording ? "⏹ Detener Mic" : "🎙 Grabar Mic"}
                </button>
              </div>

              {/* Live Transcript Box */}
              <div style={{ flex: 1, background: "rgba(2, 40, 64, 0.6)", borderRadius: "14px", padding: "18px", overflowY: "auto", border: "1px solid rgba(69, 119, 178, 0.2)", fontSize: "0.88rem", lineHeight: "1.6" }}>
                {transcript.length === 0 && !interimText && (
                  <div style={{ color: "#859CC2", fontStyle: "italic", textAlign: "center", marginTop: "40px" }}>
                    {isRecording ? "Escuchando pitch en vivo..." : "Presioná 'Grabar Mic' para iniciar la transcripción en tiempo real."}
                  </div>
                )}

                {transcript.map((line, i) => (
                  <p key={i} style={{ marginBottom: "10px", color: "#FFFFFF" }}>{line}</p>
                ))}

                {interimText && (
                  <p style={{ color: "#00A8FF", fontStyle: "italic" }}>{interimText}...</p>
                )}
              </div>

              <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
                <button
                  onClick={analyzePitch}
                  disabled={isAnalyzing}
                  style={{ flex: 1, padding: "12px", borderRadius: "12px", background: "linear-gradient(135deg, #00A8FF, #2967A3)", color: "#FFFFFF", fontWeight: 700, fontSize: "0.88rem", border: "none", cursor: "pointer", opacity: isAnalyzing ? 0.6 : 1 }}
                >
                  {isAnalyzing ? "✨ Analizando..." : "✨ Analizar Pitch con IA"}
                </button>

                <button
                  onClick={finishSession}
                  style={{ padding: "12px 18px", borderRadius: "12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(69, 119, 178, 0.3)", color: "#FFFFFF", fontWeight: 600, fontSize: "0.85rem" }}
                >
                  💾 Finalizar Ficha
                </button>
              </div>
            </div>

            {/* Right Panel: AI Copilot Evaluation Assistant */}
            <div className="live-panel" style={{ background: "rgba(7, 36, 61, 0.75)", border: "1px solid rgba(69, 119, 178, 0.28)", borderRadius: "20px", padding: "24px", backdropFilter: "blur(20px)", display: "flex", flexDirection: "column", minHeight: "60vh" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "#00A8FF", marginBottom: "12px" }}>Evaluador Copiloto IA</h3>

              <div style={{ flex: 1, background: "rgba(2, 40, 64, 0.6)", borderRadius: "14px", padding: "18px", overflowY: "auto", border: "1px solid rgba(69, 119, 178, 0.2)", fontSize: "0.85rem", lineHeight: "1.6", whiteSpace: "pre-wrap" }}>
                {aiAnalysis || (
                  <div style={{ color: "#859CC2", fontStyle: "italic", textAlign: "center", marginTop: "40px" }}>
                    Al presionar 'Analizar Pitch con IA', el copiloto evaluará el transcript acumulado contra los 5 criterios de la competencia.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: SAVED SESSIONS */}
        {step === "session" && (
          <div style={{ background: "rgba(7, 36, 61, 0.75)", border: "1px solid rgba(69, 119, 178, 0.28)", borderRadius: "20px", padding: "32px", backdropFilter: "blur(20px)" }}>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "#22C55E", marginBottom: "8px" }}>✓ Pitch Finalizado y Ficha Registrada</h2>
            <p style={{ fontSize: "0.88rem", color: "#D5DCF2", marginBottom: "24px" }}>El transcript del equipo {activeTeamName} fue guardado y procesado localmente.</p>

            <div style={{ display: "flex", gap: "16px" }}>
              <button
                onClick={() => setStep("setup")}
                style={{ padding: "14px 24px", borderRadius: "12px", background: "linear-gradient(135deg, #00A8FF, #18A0D8)", color: "#FFFFFF", fontWeight: 800, fontSize: "0.9rem", border: "none" }}
              >
                🎙️ Evaluar Siguiente Equipo
              </button>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
