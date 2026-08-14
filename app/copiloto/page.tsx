"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { INDICATORS } from "@/lib/criteria";

const TEAMS_DEFAULT = [
  { name: "Ceci Escudero", project: "Pipeline de 4 Agentes para Generación de Contenido LinkedIn (GIT)" },
  { name: "Maria Cecilia", project: "Asesor Financiero Agéntico con Reportes Semanales por Telegram" },
  { name: "Maru Portela", project: "GrowthThing — Sistema Multi-Agente de Prospecting B2B (NanoThing)" },
  { name: "Debora Menigali", project: "Colaboratech — Gestión del Conocimiento con IA (Droguería del Sur)" },
  { name: "Oscar", project: "Marketing Studio — Plataforma Agéntica Multimarca (Agencia de Marketing)" },
  { name: "Valentin", project: "Agente Postventa 24/7 por WhatsApp — Sueño Dorado Colchones" },
  { name: "Carol Lamoza", project: "Evaluador Inteligente de Licitaciones Públicas — Mercado Público (Chile)" },
  { name: "Agus Vidal", project: "CacheViti 2.0 — Consolidación Agéntica de Carteras Multi-Banco" },
  { name: "Alessandra", project: "Sistema Editorial de 2 Agentes — Libro de Bitex (Content Lab eCI)" },
  { name: "Domenico", project: "" },
];

/** Cada cuánto el LLM re-evalúa los indicadores mientras la persona habla. */
const INTERVALO_ANALISIS_MS = 18_000;
/** Cada cuánto se reenvía el transcript completo para corregir texto perdido. */
const INTERVALO_SYNC_MS = 12_000;
/** Mínimo de caracteres nuevos para gastar una llamada al LLM. */
const MIN_TEXTO_NUEVO = 120;

const BORRADOR_KEY = "eday.copiloto.borrador";

type Health = { tone: "ok" | "warn" | "bad"; msg: string } | null;

export default function CopilotoPage() {
  const [step, setStep] = useState<"setup" | "live" | "session">("setup");
  const [selectedTeam, setSelectedTeam] = useState(TEAMS_DEFAULT[0].name);
  const [customTeam, setCustomTeam] = useState("");
  const [projectName, setProjectName] = useState(TEAMS_DEFAULT[0].project);

  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [interimText, setInterimText] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [autoAnalisis, setAutoAnalisis] = useState(true);
  const [ultimoAnalisis, setUltimoAnalisis] = useState<string>("");
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);

  const [health, setHealth] = useState<Health>(null);
  const [authWarning, setAuthWarning] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);

  // El handler del WebSocket vive fuera del ciclo de render: si leyera el
  // estado directamente se quedaría con el equipo elegido al abrir el micrófono.
  const teamRef = useRef("");
  const projectRef = useRef("");
  const textoRef = useRef("");
  const largoAnalizadoRef = useRef(0);

  const activeTeamName = customTeam.trim() || selectedTeam;

  useEffect(() => {
    const found = TEAMS_DEFAULT.find((t) => t.name === selectedTeam);
    if (found) setProjectName(found.project);
  }, [selectedTeam]);

  useEffect(() => {
    teamRef.current = activeTeamName;
    projectRef.current = projectName;
  }, [activeTeamName, projectName]);

  useEffect(() => {
    textoRef.current = (transcript.join(" ") + " " + interimText).trim();
  }, [transcript, interimText]);

  // Autoscroll: sin esto el texto nuevo queda abajo, fuera de vista.
  useEffect(() => {
    const box = transcriptBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [transcript, interimText]);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setAuthWarning(!d.enabled))
      .catch(() => {});
  }, []);

  // Borrador local: si se recarga la pestaña a mitad de un pitch, no se pierde.
  useEffect(() => {
    if (step !== "live") return;
    const t = setInterval(() => {
      try {
        localStorage.setItem(
          BORRADOR_KEY,
          JSON.stringify({ team: teamRef.current, project: projectRef.current, texto: textoRef.current })
        );
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BORRADOR_KEY);
      if (!raw) return;
      const b = JSON.parse(raw);
      if (b?.texto && b.texto.length > 40) {
        setHealth({
          tone: "warn",
          msg: `Hay un borrador sin cerrar de ${b.team}. Se recupera al iniciar ese equipo.`,
        });
      }
    } catch {}
  }, []);

  const stopAudio = useCallback(() => {
    if (socketRef.current) {
      try { socketRef.current.close(); } catch {}
      socketRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop(); } catch {}
      mediaRecorderRef.current = null;
    }
    // Liberar el micrófono de verdad: si no, el indicador del navegador
    // queda prendido después de detener.
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const publicar = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/stream-transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team: teamRef.current, project: projectRef.current, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setHealth({ tone: "bad", msg: data.error || `La pantalla pública no recibe (HTTP ${res.status}).` });
        return false;
      }
      setHealth({ tone: "ok", msg: "Transmitiendo a la pantalla pública" });
      return true;
    } catch (e: any) {
      setHealth({ tone: "bad", msg: e?.message || "Error de red al transmitir." });
      return false;
    }
  }, []);

  /** Recalcula los 6 indicadores y los empuja a la pantalla pública. */
  const analizarIndicadores = useCallback(async (texto: string) => {
    if (texto.length < 40) return;
    try {
      const res = await fetch("/api/eval-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team: teamRef.current, project: projectRef.current, transcript: texto }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHealth({ tone: "bad", msg: data.error || "No se pudieron calcular los indicadores." });
        return;
      }
      if (data.metrics) setMetrics(data.metrics);
      if (data.broadcastError) setHealth({ tone: "bad", msg: data.broadcastError });
      setUltimoAnalisis(new Date().toLocaleTimeString("es-AR"));
      largoAnalizadoRef.current = texto.length;
    } catch {
      setHealth({ tone: "bad", msg: "Error de red al analizar indicadores." });
    }
  }, []);

  // ── Los dos latidos que corren mientras se graba ──────────────

  // 1) El LLM re-evalúa los indicadores cada tanto: es lo que hace que las
  //    barras suban y bajen solas mientras la persona habla.
  useEffect(() => {
    if (!isRecording || !autoAnalisis) return;
    const t = setInterval(() => {
      const texto = textoRef.current;
      if (texto.length - largoAnalizadoRef.current < MIN_TEXTO_NUEVO) return;
      analizarIndicadores(texto);
    }, INTERVALO_ANALISIS_MS);
    return () => clearInterval(t);
  }, [isRecording, autoAnalisis, analizarIndicadores]);

  // 2) Reenvío del transcript completo, para que la pantalla pública se
  //    corrija sola si perdió algún evento.
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => {
      if (textoRef.current) publicar({ mode: "sync", fullText: textoRef.current });
    }, INTERVALO_SYNC_MS);
    return () => clearInterval(t);
  }, [isRecording, publicar]);

  const startSession = () => {
    setStep("live");
    setAiAnalysis("");
    setMetrics(null);
    setUltimoAnalisis("");
    largoAnalizadoRef.current = 0;

    // Recuperar borrador si es el mismo equipo
    let recuperado: string[] = [];
    try {
      const raw = localStorage.getItem(BORRADOR_KEY);
      if (raw) {
        const b = JSON.parse(raw);
        if (b?.team === activeTeamName && b?.texto) {
          recuperado = [b.texto];
          setHealth({ tone: "warn", msg: "Se recuperó el borrador de este equipo." });
        }
      }
    } catch {}
    setTranscript(recuperado);
    setInterimText("");
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopAudio();
      if (textoRef.current) publicar({ mode: "sync", fullText: textoRef.current });
      return;
    }

    try {
      const tokenRes = await fetch("/api/deepgram-token", { method: "POST" });
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok || !tokenData.token) {
        const detalle = tokenData.intentos
          ? Object.entries(tokenData.intentos).map(([m, r]) => `• ${m}: ${r}`).join("\n")
          : tokenData.detail || "";
        setHealth({ tone: "bad", msg: tokenData.error || "Deepgram rechazó la credencial." });
        alert(
          "Error conectando con el servicio de transcripción:\n\n" +
            [tokenData.error || `HTTP ${tokenRes.status}`, detalle, tokenData.ayuda].filter(Boolean).join("\n\n")
        );
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      let mimeType = "audio/webm";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
        else if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
        else if (MediaRecorder.isTypeSupported("audio/mp4")) mimeType = "audio/mp4";
      }

      const wsUrl =
        "wss://api.deepgram.com/v1/listen?model=nova-2&language=es&smart_format=true&punctuate=true&interim_results=true";
      const socket = new WebSocket(wsUrl, [tokenData.scheme || "bearer", tokenData.token]);

      socket.onopen = () => {
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(event.data);
        });
        mediaRecorder.start(250);
        mediaRecorderRef.current = mediaRecorder;
        setHealth({ tone: "ok", msg: "Micrófono conectado, transcribiendo" });
      };

      socket.onmessage = (message) => {
        const received = JSON.parse(message.data);
        const texto = received.channel?.alternatives?.[0]?.transcript;
        if (!texto) return;

        if (received.is_final) {
          setTranscript((prev) => [...prev, texto]);
          setInterimText("");

          fetch("/api/fichas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              team: teamRef.current,
              project: projectRef.current,
              textChunk: texto,
            }),
          }).catch(() => {});

          publicar({ textChunk: texto, isFinal: true });
        } else {
          setInterimText(texto);
        }
      };

      socket.onerror = () => setHealth({ tone: "bad", msg: "Error en la conexión con Deepgram." });
      socket.onclose = () => setIsRecording(false);

      socketRef.current = socket;
      setIsRecording(true);
    } catch (err: any) {
      console.error("Error al iniciar grabación:", err);
      alert("Error al iniciar audio: " + (err.message || err.toString()));
      stopAudio();
    }
  };

  /** Análisis narrativo completo, a pedido del operador. */
  const analizarPitch = async () => {
    setIsAnalyzing(true);
    const texto = textoRef.current;
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team: activeTeamName,
          project: projectName,
          transcript: texto,
          question: "Evaluar presentación del equipo y sugerir notas",
        }),
      });
      const data = await res.json();
      setAiAnalysis(data.text || data.error || "Análisis completado.");
      await analizarIndicadores(texto);
    } catch {
      setAiAnalysis("Error en la conexión con la IA de evaluación.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const finishSession = async () => {
    stopAudio();
    const texto = textoRef.current;
    if (texto) await publicar({ mode: "sync", fullText: texto });

    try {
      const res = await fetch("/api/fichas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          team: activeTeamName,
          project: projectName,
          textChunk: interimText,
          analysis: aiAnalysis,
          metrics,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.broadcastError) setHealth({ tone: "bad", msg: data.broadcastError });
      else setHealth({ tone: "ok", msg: "Ficha registrada y transmitida" });
    } catch (e) {
      console.error("Error al finalizar ficha:", e);
      setHealth({ tone: "bad", msg: "No se pudo registrar la ficha." });
    }

    try { localStorage.removeItem(BORRADOR_KEY); } catch {}
    setStep("session");
  };

  const chipClass = health ? `chip chip--${health.tone} chip--msg` : "";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <img className="topbar__logo" src="/logos argentina/PNG/SIN BAJADA/02.png" alt="eCommerce DAY Argentina" />
          <div className="topbar__divider" />
          <div>
            <div className="topbar__title">Copiloto de Evaluación</div>
            <div className="topbar__sub">eCommerce StartUp Competition · Argentina 2026</div>
          </div>
        </div>
        <div className="topbar__actions">
          {health && <span className={chipClass} title={health.msg}>{health.msg}</span>}
          <a className="btn btn--ghost btn--sm" href="/publico" target="_blank" rel="noreferrer">
            Pantalla pública ↗
          </a>
        </div>
      </header>

      {authWarning && (
        <div className="notice notice--warn">
          <span>▲</span>
          <span>
            Este panel está sin contraseña. Definí <strong>ADMIN_PASSWORD</strong> en Vercel para que
            sólo el operador pueda escribir en la pantalla pública.
          </span>
        </div>
      )}

      {step === "setup" && (
        <div className="card stack">
          <div>
            <div className="eyebrow">Paso 1 · Configuración</div>
            <h2 style={{ fontSize: "var(--fs-xl)", fontWeight: 800, marginTop: 4 }}>¿Quién presenta?</h2>
          </div>

          <div className="form-grid">
            <div>
              <label className="label" htmlFor="equipo">Equipo</label>
              <select
                id="equipo"
                className="input"
                value={selectedTeam}
                onChange={(e) => { setSelectedTeam(e.target.value); setCustomTeam(""); }}
              >
                {TEAMS_DEFAULT.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              <input
                className="input"
                style={{ marginTop: 10 }}
                type="text"
                placeholder="O escribí otro nombre…"
                value={customTeam}
                onChange={(e) => setCustomTeam(e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="proyecto">Proyecto / Solución</label>
              <input
                id="proyecto"
                className="input"
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
          </div>

          <div>
            <div className="label" style={{ marginBottom: 10 }}>Los 6 indicadores · 1 a 5 pts</div>
            <div className="pill-row">
              {INDICATORS.map((ind) => (
                <div className="pill" key={ind.key}>
                  <span>{ind.icon}</span>
                  <strong>{ind.label}</strong>
                </div>
              ))}
            </div>
          </div>

          <button className="btn btn--primary btn--block" onClick={startSession}>
            🎙️ Iniciar evaluación de {activeTeamName}
          </button>
        </div>
      )}

      {step === "live" && (
        <div className="console">
          <section className="card console__panel">
            <div className="section-head">
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">En vivo</div>
                <h3 style={{ marginTop: 3 }}>{activeTeamName}</h3>
                <div className="ficha__proj">{projectName}</div>
              </div>
              <button
                className={`btn ${isRecording ? "btn--stop" : "btn--rec"}`}
                onClick={toggleRecording}
              >
                {isRecording ? "⏹ Detener" : "🎙 Grabar"}
              </button>
            </div>

            <div className="transcript transcript--op" ref={transcriptBoxRef}>
              {transcript.length === 0 && !interimText ? (
                <div className="transcript__empty">
                  {isRecording ? "Escuchando…" : "Tocá Grabar para empezar a transcribir."}
                </div>
              ) : (
                <>
                  {transcript.map((line, i) => <p key={i}>{line}</p>)}
                  {interimText && <p className="transcript__interim">{interimText}…</p>}
                </>
              )}
            </div>

            <div className="console__actions">
              <button className="btn btn--primary" onClick={analizarPitch} disabled={isAnalyzing}>
                {isAnalyzing ? "✨ Analizando…" : "✨ Analizar pitch"}
              </button>
              <button className="btn btn--ghost" onClick={finishSession}>💾 Finalizar ficha</button>
            </div>
          </section>

          <section className="card console__panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">Indicadores en vivo</div>
                <h3 style={{ marginTop: 3 }}>Evaluador Copiloto IA</h3>
              </div>
              <label className="chip chip--mute" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={autoAnalisis}
                  onChange={(e) => setAutoAnalisis(e.target.checked)}
                  style={{ accentColor: "var(--brand)" }}
                />
                AUTO
              </label>
            </div>

            <div className="meters meters--compact" style={{ marginBottom: "var(--gap)" }}>
              {INDICATORS.map((ind) => {
                const val = metrics?.[ind.key] ?? 50;
                const color = val > 65 ? "var(--green)" : val > 45 ? "var(--brand)" : val > 30 ? "var(--gold)" : "var(--red)";
                return (
                  <div className="meter" key={ind.key}>
                    <div className="meter__top">
                      <div className="meter__name">
                        <span className="meter__icon">{ind.icon}</span>
                        <span className="meter__label">{ind.short}</span>
                      </div>
                      <span className="meter__val" style={{ color }}>{val}</span>
                    </div>
                    <div className="meter__track">
                      <div className="meter__mid" />
                      <div className="meter__fill" style={{ width: `${val}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: "var(--fs-micro)" }} className="muted mono">
              {isRecording && autoAnalisis
                ? `Re-analizando cada ${INTERVALO_ANALISIS_MS / 1000}s · último: ${ultimoAnalisis || "—"}`
                : "Análisis automático en pausa"}
            </div>

            <div
              className={`ficha__body${aiAnalysis ? " ficha__body--ai" : ""}`}
              style={{ marginTop: "var(--gap)", maxHeight: "none", flex: 1, overflowY: "auto" }}
            >
              {aiAnalysis ? (
                <>
                  <span className="ficha__tag" style={{ color: "var(--brand)" }}>Evaluación de la IA</span>
                  {aiAnalysis}
                </>
              ) : (
                <div className="transcript__empty" style={{ padding: "8% 0" }}>
                  Las barras se mueven solas mientras se habla.
                  <br />
                  Tocá &laquo;Analizar pitch&raquo; para el veredicto escrito.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {step === "session" && (
        <div className="card stack">
          <div>
            <div className="eyebrow" style={{ color: "var(--green)" }}>✓ Listo</div>
            <h2 style={{ fontSize: "var(--fs-xl)", fontWeight: 800, marginTop: 4 }}>
              Pitch finalizado y ficha registrada
            </h2>
            <p className="soft" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
              El transcript de {activeTeamName} quedó transmitido a la pantalla pública.
            </p>
          </div>
          <div>
            <button className="btn btn--primary" onClick={() => setStep("setup")}>
              🎙️ Evaluar siguiente equipo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
