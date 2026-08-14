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

/** Cuántas lecturas del LLM guarda cada indicador para dibujar su recorrido. */
const LARGO_HISTORIA = 18;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Lleva los valores mostrados hacia los valores reales de a poco, cuadro por
 * cuadro. Sin esto la barra se queda quieta 12 segundos y después pega un
 * salto: el LLM entrega una lectura cada tanto, pero el recorrido entre una
 * y otra se puede recorrer de forma continua, que es lo que se lee como
 * "tiempo real" en pantalla.
 *
 * No inventa movimiento: sólo interpola entre dos mediciones reales.
 */
function useValoresAnimados(objetivo: Metrics, duracion = 2600): Metrics {
  const [mostrado, setMostrado] = useState<Metrics>(objetivo);
  const desdeRef = useRef<Metrics>(objetivo);
  const inicioRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    desdeRef.current = { ...mostrado };
    inicioRef.current = performance.now();

    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - inicioRef.current) / duracion);
      const k = easeOut(t);
      const siguiente: Metrics = {};
      for (const key of Object.keys(objetivo)) {
        const a = desdeRef.current[key] ?? 50;
        const b = objetivo[key] ?? 50;
        siguiente[key] = a + (b - a) * k;
      }
      setMostrado(siguiente);
      if (t < 1) rafRef.current = requestAnimationFrame(paso);
    };

    rafRef.current = requestAnimationFrame(paso);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // `mostrado` a propósito fuera de las dependencias: se lee como punto de
    // partida, incluirlo reiniciaría la animación en cada cuadro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objetivo, duracion]);

  return mostrado;
}

/**
 * Puntos del recorrido de un indicador.
 *
 * Se escala al rango propio de la serie, no de 0 a 100: una variación de 5
 * puntos sobre una escala de 100 se dibuja como una línea recta y no se ve
 * nada. El piso de 14 puntos evita que una serie casi plana se vea como una
 * montaña rusa.
 */
function puntosRecorrido(serie: number[]): string {
  const min = Math.min(...serie);
  const max = Math.max(...serie);
  const centro = (min + max) / 2;
  const span = Math.max(max - min, 14);
  const desde = centro - span / 2;
  const alto = 22;
  const margen = 2;

  return serie
    .map((v, i) => {
      const x = (i / (serie.length - 1)) * 100;
      const y = margen + (1 - (v - desde) / span) * alto;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
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
  const [historia, setHistoria] = useState<Record<string, number[]>>({});
  const [pulso, setPulso] = useState(0);
  const [pulsando, setPulsando] = useState(false);
  const [ultimaLectura, setUltimaLectura] = useState<number | null>(null);
  const [ultimaFrase, setUltimaFrase] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  const boxRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<Metrics>(neutralMetrics());

  // Valores interpolados: lo que realmente se dibuja en pantalla.
  const vistos = useValoresAnimados(metrics);

  // Destello al llegar una lectura. Se hace con una clase temporal y NO
  // cambiando la key del nodo: re-montar el elemento cortaba en seco la
  // interpolación cuadro por cuadro y hacía parpadear la barra.
  useEffect(() => {
    if (!pulso) return;
    setPulsando(true);
    const t = setTimeout(() => setPulsando(false), 1500);
    return () => clearTimeout(t);
  }, [pulso]);

  // Reloj de baja frecuencia para los "hace Ns" del encabezado.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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
    setUltimaLectura(Date.now());
    setPulso((n) => n + 1);
    setHistoria((prev) => {
      const sig: Record<string, number[]> = {};
      for (const key of Object.keys(nuevas)) {
        sig[key] = [...(prev[key] || []), nuevas[key]].slice(-LARGO_HISTORIA);
      }
      return sig;
    });
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

    // Este refetch es la red de seguridad y va SIEMPRE, incluso sin Pusher:
    // antes estaba después del return de abajo, así que justo cuando el canal
    // en vivo no andaba la pantalla se quedaba congelada para siempre.
    const t = setInterval(cargarDelServidor, 20_000);

    if (!PUSHER_KEY) {
      setConfigError("Falta NEXT_PUBLIC_PUSHER_KEY: la pantalla actualiza sólo cada 20s.");
      return () => clearInterval(t);
    }

    const pusher = new PusherClient(PUSHER_KEY, { cluster: PUSHER_CLUSTER, forceTLS: true });
    pusher.connection.bind("connected", () => { setConectado(true); setConfigError(""); });
    pusher.connection.bind("disconnected", () => setConectado(false));
    pusher.connection.bind("error", () => setConfigError("No se pudo conectar al canal en tiempo real."));

    const channel = pusher.subscribe(PUSHER_CHANNEL);

    channel.bind(PUSHER_EVENTS.transcript, (d: { team: string; project: string; textChunk: string }) => {
      setActivePitch({ team: d.team, project: d.project });
      setTexto((prev) => (prev ? prev + " " : "") + d.textChunk);
      setUltimaFrase(Date.now());
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
      setHistoria({});
      setUltimaLectura(null);
      setUltimaFrase(null);
    });

    return () => {
      clearInterval(t);
      pusher.unsubscribe(PUSHER_CHANNEL);
      pusher.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Respaldo en mano. El historial vive en este navegador y en el servidor,
   * pero un archivo descargado es el único que no depende de ninguno de los
   * dos. Al final de la jornada, un click y te lo llevás.
   */
  const descargarFichas = () => {
    const payload = {
      evento: "eCommerce StartUp Competition Argentina 2026",
      exportado: new Date().toISOString(),
      equipos: finished.length,
      fichas: finished,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `fichas-eday-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Hubo texto nuevo hace menos de 6s: está entrando audio de verdad. */
  const escuchando = ultimaFrase !== null && ahora - ultimaFrase < 6000;

  const estado = configError
    ? { cls: "chip chip--bad", txt: "SIN CANAL" }
    : conectado
    ? { cls: "chip chip--ok", txt: "EN VIVO" }
    : { cls: "chip chip--warn", txt: "RECONECTANDO" };

  return (
    <div className="shell shell--wide">
      <header className="topbar">
        <div className="topbar__brand">
          {/* El logo siempre vuelve al dashboard */}
          <a href="/" aria-label="Ir al dashboard">
            <img className="topbar__logo" src="/logos argentina/PNG/SIN BAJADA/02.png" alt="eCommerce DAY Argentina" />
          </a>
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
          {/* Estado real del análisis, no una leyenda fija: se ve si está
              entrando audio y hace cuánto fue la última lectura del LLM. */}
          <div className="live-state mono">
            <span className={`live-state__dot${escuchando ? " live-state__dot--on" : ""}`} />
            <span>{escuchando ? "Escuchando" : "En espera"}</span>
            <span className="live-state__sep">·</span>
            <span>
              {ultimaLectura
                ? `Última lectura hace ${Math.max(0, Math.round((ahora - ultimaLectura) / 1000))}s`
                : "Sin lecturas aún"}
            </span>
          </div>
        </div>

        <div className="meters">
          {INDICATORS.map((ind) => {
            // El valor animado es el que se dibuja; el real, el que decide color y estado.
            const animado = vistos[ind.key] ?? 50;
            const val = Math.round(animado);
            const objetivo = Math.round(metrics[ind.key] ?? 50);
            const prev = Math.round(previas[ind.key] ?? 50);
            const delta = objetivo - prev;
            const { color, txt } = banda(objetivo);
            const serie = historia[ind.key] || [];

            return (
              <div
                className={`meter${pulsando ? " meter--pulse" : ""}`}
                key={ind.key}
                /* El valor animado y el color van como custom properties: así
                   el CSS decide si se dibuja horizontal o como fader vertical. */
                style={{ "--v": animado, "--c": color } as React.CSSProperties}
              >
                <div className="meter__top">
                  <div className="meter__name">
                    <span className="meter__icon">{ind.icon}</span>
                    {/* Nombre completo en desktop, corto en el fader vertical:
                        rotado, el largo no entra y quedaba cortado. */}
                    <span className="meter__label">{ind.label}</span>
                    <span className="meter__label meter__label--short">{ind.short}</span>
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
                  <div className="meter__fill" />
                </div>

                {/* Recorrido de las últimas lecturas: deja ver la tendencia,
                    no sólo el valor de ahora. */}
                {serie.length > 1 && (
                  <svg className="meter__spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
                    <polyline
                      points={puntosRecorrido(serie)}
                      fill="none"
                      stroke={color}
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    {/* Punta: dónde está parado ahora mismo */}
                    <circle
                      cx="100"
                      cy={puntosRecorrido(serie).split(" ").pop()?.split(",")[1]}
                      r="2.2"
                      fill={color}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}

                <div className="meter__status">{txt}</div>
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
          {finished.length > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={descargarFichas}>
              ↓ Descargar respaldo
            </button>
          )}
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
