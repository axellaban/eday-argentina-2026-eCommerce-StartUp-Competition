"use client";

import { useEffect, useRef, useState } from "react";
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

/**
 * El historial se guarda también en el navegador. La pantalla de sala es una
 * sola máquina que queda abierta todo el evento, así que es el lugar más
 * confiable para conservarlo: sobrevive a recargas aunque no haya KV.
 */
const STORE_KEY = "eday.publico.fichas";

function leerLocal(): TeamSession[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function guardarLocal(sesiones: TeamSession[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(sesiones.slice(0, 40)));
  } catch {}
}

function fusionar(a: TeamSession[], b: TeamSession[]): TeamSession[] {
  const porEquipo = new Map<string, TeamSession>();
  [...a, ...b].forEach((s) => {
    if (!s?.team) return;
    const previa = porEquipo.get(s.team);
    // Gana la versión con más texto: nunca perdemos transcript.
    if (!previa || (s.transcript?.length || 0) >= (previa.transcript?.length || 0)) {
      porEquipo.set(s.team, { ...previa, ...s });
    }
  });
  return Array.from(porEquipo.values());
}

const banda = (v: number) =>
  v > 65 ? { color: "var(--green)", txt: "Alto" }
  : v > 55 ? { color: "var(--brand)", txt: "Favorable" }
  : v >= 45 ? { color: "var(--brand)", txt: "Neutro" }
  : v > 30 ? { color: "var(--gold)", txt: "En observación" }
  : { color: "var(--red)", txt: "Bajo" };

export default function PublicoPage() {
  const [activePitch, setActivePitch] = useState<{ team: string; project: string } | null>(null);
  const [texto, setTexto] = useState("");
  const [metrics, setMetrics] = useState<Metrics>(neutralMetrics);
  const [previas, setPrevias] = useState<Metrics>(neutralMetrics);
  const [finished, setFinished] = useState<TeamSession[]>([]);
  const [conectado, setConectado] = useState(false);
  const [configError, setConfigError] = useState("");

  const boxRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<Metrics>(neutralMetrics());

  // Autoscroll de los subtítulos: era la razón principal por la que el
  // transcript "no aparecía completo" — el texto estaba, pero abajo del corte.
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [texto]);

  const aplicarMetrics = (nuevas: Metrics) => {
    setPrevias(metricsRef.current);
    metricsRef.current = nuevas;
    setMetrics(nuevas);
  };

  const cargarDelServidor = async () => {
    try {
      const res = await fetch("/api/fichas", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();

      if (Array.isArray(data.finishedSessions)) {
        setFinished((actual) => {
          const fusionadas = fusionar(actual, data.finishedSessions);
          guardarLocal(fusionadas);
          return fusionadas;
        });
      }
      if (data.activeSession && !data.activeSession.isFinished) {
        setActivePitch({ team: data.activeSession.team, project: data.activeSession.project });
        // Sólo adoptamos el texto del servidor si es más largo que el que
        // tenemos: si no, un GET viejo borraría lo recién llegado por Pusher.
        setTexto((prev) =>
          (data.activeSession.transcript?.length || 0) > prev.length ? data.activeSession.transcript : prev
        );
        if (data.activeSession.metrics) aplicarMetrics(data.activeSession.metrics);
      }
    } catch {}
  };

  useEffect(() => {
    setFinished(leerLocal());
    cargarDelServidor();

    if (!PUSHER_KEY) {
      setConfigError("Falta NEXT_PUBLIC_PUSHER_KEY: la pantalla no recibe el pitch en vivo.");
      return;
    }

    const pusher = new PusherClient(PUSHER_KEY, { cluster: PUSHER_CLUSTER, forceTLS: true });
    pusher.connection.bind("connected", () => { setConectado(true); setConfigError(""); });
    pusher.connection.bind("disconnected", () => setConectado(false));
    pusher.connection.bind("error", () => setConfigError("No se pudo conectar al canal en tiempo real."));

    const channel = pusher.subscribe(PUSHER_CHANNEL);

    channel.bind(PUSHER_EVENTS.transcript, (d: { team: string; project: string; textChunk: string }) => {
      setActivePitch({ team: d.team, project: d.project });
      setTexto((prev) => (prev ? prev + " " : "") + d.textChunk);
    });

    // Reemplaza el texto completo: corrige lo que se haya perdido.
    channel.bind(PUSHER_EVENTS.sync, (d: { team: string; project: string; fullText: string }) => {
      setActivePitch({ team: d.team, project: d.project });
      setTexto((prev) => (d.fullText.length >= prev.length ? d.fullText : prev));
    });

    channel.bind(PUSHER_EVENTS.metrics, (d: { metrics: Metrics }) => {
      if (d.metrics) aplicarMetrics(d.metrics);
    });

    channel.bind(PUSHER_EVENTS.finish, (d: TeamSession) => {
      setFinished((prev) => {
        const fusionadas = fusionar([d], prev);
        guardarLocal(fusionadas);
        return fusionadas;
      });
      setActivePitch(null);
      setTexto("");
      aplicarMetrics(neutralMetrics());
    });

    // Red de seguridad: si Pusher se cortó un rato, esto vuelve a alinear.
    const t = setInterval(cargarDelServidor, 20_000);

    return () => {
      clearInterval(t);
      pusher.unsubscribe(PUSHER_CHANNEL);
      pusher.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estado = configError
    ? { cls: "chip chip--bad", txt: "SIN CANAL" }
    : conectado
    ? { cls: "chip chip--ok", txt: "EN VIVO" }
    : { cls: "chip chip--warn", txt: "RECONECTANDO" };

  return (
    <div className="shell shell--wide">
      <header className="topbar">
        <div className="topbar__brand">
          <img className="topbar__logo" src="/logos argentina/PNG/SIN BAJADA/02.png" alt="eCommerce DAY Argentina" />
          <div className="topbar__divider" />
          <div>
            <div className="topbar__title">Demo Day · En Vivo</div>
            <div className="topbar__sub">eCommerce StartUp Competition Argentina 2026</div>
          </div>
        </div>
        <div className="topbar__actions">
          <span className={estado.cls} title={configError || undefined}>
            <span className="chip__dot" />
            {estado.txt}
          </span>
        </div>
      </header>

      {/* ── Pitch en vivo ── */}
      <section className="card">
        <div className="section-head">
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Presentando ahora</div>
            <h2 style={{ fontSize: "var(--fs-2xl)", marginTop: 2 }}>
              {activePitch ? activePitch.team : "Esperando el próximo pitch…"}
            </h2>
            {activePitch?.project && <div className="ficha__proj">{activePitch.project}</div>}
          </div>
        </div>

        <div className="transcript transcript--live" ref={boxRef}>
          {texto ? texto : <div className="transcript__empty">Las palabras del orador van a aparecer acá en vivo.</div>}
        </div>
      </section>

      {/* ── Los 6 indicadores ── */}
      <section className="card">
        <div className="section-head">
          <div>
            <div className="eyebrow">Análisis dinámico</div>
            <h3 style={{ marginTop: 2 }}>Indicadores del equipo activo</h3>
          </div>
          <div className="muted mono" style={{ fontSize: "var(--fs-micro)" }}>
            La IA reevalúa mientras se habla · 50 = neutro
          </div>
        </div>

        <div className="meters">
          {INDICATORS.map((ind) => {
            const val = Math.round(metrics[ind.key] ?? 50);
            const prev = Math.round(previas[ind.key] ?? 50);
            const delta = val - prev;
            const { color, txt } = banda(val);

            return (
              <div className={`meter${delta !== 0 ? " meter--moved" : ""}`} key={ind.key}>
                <div className="meter__top">
                  <div className="meter__name">
                    <span className="meter__icon">{ind.icon}</span>
                    <span className="meter__label">{ind.label}</span>
                  </div>
                  <div className="meter__right">
                    <span
                      className={`meter__delta meter__delta--${delta > 0 ? "up" : "down"}${delta !== 0 ? " meter__delta--show" : ""}`}
                    >
                      {delta > 0 ? "▲" : "▼"}{Math.abs(delta)}
                    </span>
                    <span className="meter__val" style={{ color }}>{val}</span>
                  </div>
                </div>

                <div className="meter__track">
                  <div className="meter__mid" />
                  <div className="meter__fill" style={{ width: `${val}%`, background: color }} />
                </div>

                <div className="meter__status" style={{ marginTop: 7 }}>{txt}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Historial ── */}
      <section className="card">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ color: "var(--green)" }}>Fichas registradas</div>
            <h3 style={{ marginTop: 2 }}>Equipos presentados ({finished.length})</h3>
          </div>
        </div>

        {finished.length === 0 ? (
          <div className="empty">Las fichas van a aparecer acá a medida que cada equipo termine.</div>
        ) : (
          finished.map((s, i) => (
            <article className="ficha" key={`${s.team}-${i}`}>
              <div className="ficha__head">
                <div>
                  <span className="ficha__tag" style={{ color: "var(--green)" }}>
                    ✓ Finalizado · {s.timestamp}
                  </span>
                  <div className="ficha__name">{s.team}</div>
                  <div className="ficha__proj">{s.project}</div>
                </div>
              </div>

              {s.transcript && (
                <div className="ficha__body">
                  <span className="ficha__tag">Transcripción completa</span>
                  {s.transcript}
                </div>
              )}

              {s.analysis && (
                <div className="ficha__body ficha__body--ai">
                  <span className="ficha__tag" style={{ color: "var(--brand)" }}>💡 Evaluación de la IA</span>
                  {s.analysis}
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
