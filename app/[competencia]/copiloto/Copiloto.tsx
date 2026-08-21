"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import FichaTexto from "@/app/components/FichaTexto";
import TranscriptMarcado, { LeyendaMarcas, Marca, TipoMarca } from "@/app/components/TranscriptMarcado";
import type { Competencia, Equipo } from "@/lib/competencias";


/** Cada cuánto el LLM re-evalúa los indicadores mientras la persona habla.
 *  12s da unas 50 lecturas en un pitch de 10 minutos: suficiente para que la
 *  vista en vivo tenga siempre un tramo nuevo que recorrer. */
const INTERVALO_ANALISIS_MS = 12_000;
/** Cada cuánto se reenvía el transcript completo para corregir texto perdido. */
const INTERVALO_SYNC_MS = 12_000;
/** Mínimo de caracteres nuevos para gastar una llamada al LLM. */
const MIN_TEXTO_NUEVO = 90;
/** El marcado del transcript es para leer, no para mirar: va más espaciado. */
const INTERVALO_MARCAS_MS = 24_000;

/** Reintentos automáticos si Deepgram corta la conexión a mitad del pitch. */
const MAX_REINTENTOS_MIC = 4;

/** Un borrador por equipo: antes había una sola clave y arrancar el equipo
 *  siguiente pisaba el borrador del anterior a los 5 segundos. */
const BORRADOR_KEY = "eday.copiloto.borrador";
/** La competición entra en la clave: dos competiciones pueden tener un equipo
 *  con el mismo nombre y el borrador de una no debe aparecer en la otra. */
const borradorKey = (slug: string, equipo: string) => `${BORRADOR_KEY}.${slug}.${equipo}`;

type Health = { tone: "ok" | "warn" | "bad"; msg: string } | null;

/** Lo que hace falta saber de una sesión guardada para decidir si se borra. */
type SesionGuardada = {
  team: string;
  project?: string;
  timestamp?: string;
  isFinished: boolean;
  largo: number;
  tieneFicha: boolean;
  esActiva: boolean;
};

export default function Copiloto({ comp }: { comp: Competencia }) {
  /**
   * Los equipos salen de la PLANILLA de esta competición, no del código.
   *
   * Arrancan con la lista del registro para que el selector nunca aparezca
   * vacío, y /api/equipos la reemplaza con lo que haya en el Sheet apenas
   * responde. Así, sumar un equipo el día del evento es agregar una fila,
   * no deployar.
   */
  const [EQUIPOS, setEquipos] = useState<Equipo[]>(comp.equipos);
  const [fuenteEquipos, setFuenteEquipos] = useState<"planilla" | "registro" | null>(null);
  const [errorEquipos, setErrorEquipos] = useState<string | null>(null);
  const [cargandoEquipos, setCargandoEquipos] = useState(false);

  const [step, setStep] = useState<"setup" | "live" | "session">("setup");
  const [selectedTeam, setSelectedTeam] = useState(comp.equipos[0]?.name || "");
  const [customTeam, setCustomTeam] = useState("");
  const [projectName, setProjectName] = useState(comp.equipos[0]?.project || "");

  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [interimText, setInterimText] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [autoAnalisis, setAutoAnalisis] = useState(true);
  const [ultimoAnalisis, setUltimoAnalisis] = useState<string>("");
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  const [micCaido, setMicCaido] = useState(false);
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [preguntas, setPreguntas] = useState<string[]>([]);
  const [resueltas, setResueltas] = useState<string[]>([]);
  const [lecturas, setLecturas] = useState(0);
  const [segundos, setSegundos] = useState(0);

  const [health, setHealth] = useState<Health>(null);
  const [authWarning, setAuthWarning] = useState(false);

  // Sesiones ya guardadas, para poder limpiar los ensayos antes del evento.
  const [guardadas, setGuardadas] = useState<SesionGuardada[]>([]);
  const [cargandoGuardadas, setCargandoGuardadas] = useState(false);
  const [porBorrar, setPorBorrar] = useState<string | null>(null);
  const [durable, setDurable] = useState<boolean | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);

  // El handler del WebSocket vive fuera del ciclo de render: si leyera el
  // estado directamente se quedaría con el equipo elegido al abrir el micrófono.
  const teamRef = useRef("");
  const projectRef = useRef("");
  const textoRef = useRef("");
  const textoFinalRef = useRef("");
  const largoAnalizadoRef = useRef(0);
  const enVueloRef = useRef(false);
  const lecturasRef = useRef(0);
  const marcasEnVueloRef = useRef(false);
  const preguntasRef = useRef<string[]>([]);
  // Espejo de las marcas para leerlas dentro de los intervalos, igual que las
  // preguntas: el estado de React no se ve desde adentro de un setInterval.
  const marcasRef = useRef<Marca[]>([]);
  const largoMarcadoRef = useRef(0);
  const metricsRef = useRef<Record<string, number> | null>(null);
  const detenidoAdredeRef = useRef(false);
  const reintentosRef = useRef(0);

  const activeTeamName = customTeam.trim() || selectedTeam;

  /**
   * Trae los equipos de la planilla.
   *
   * El endpoint nunca falla: si Google no contesta devuelve la lista del
   * registro con el motivo adentro. Eso se muestra en pantalla en vez de
   * tragárselo, porque un operador que ve nombres viejos y no sabe por qué
   * va a perder tiempo justo cuando no lo tiene.
   */
  const cargarEquipos = useCallback(async () => {
    setCargandoEquipos(true);
    try {
      const res = await fetch(
        `/api/equipos?competencia=${encodeURIComponent(comp.slug)}&t=${Date.now()}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorEquipos(data.error || `No se pudo leer la planilla (HTTP ${res.status}).`);
        return;
      }
      if (Array.isArray(data.equipos) && data.equipos.length) {
        setEquipos(data.equipos);
        // Si el equipo elegido ya no está en la planilla, se pasa al primero:
        // dejarlo seleccionado grabaría el pitch contra un nombre fantasma.
        setSelectedTeam((actual) => {
          const sigue = data.equipos.some((e: Equipo) => e.name === actual);
          const elegido = sigue ? actual : data.equipos[0].name;
          // Sólo se completa el proyecto si el campo está en blanco: si el
          // operador ya escribió algo, manda lo que escribió.
          setProjectName((p) =>
            p ? p : (data.equipos.find((e: Equipo) => e.name === elegido)?.project || "")
          );
          return elegido;
        });
      }
      setFuenteEquipos(data.fuente || null);
      setErrorEquipos(data.error || null);
    } catch (e: any) {
      setErrorEquipos(e?.message || "Error de red leyendo la planilla.");
    } finally {
      setCargandoEquipos(false);
    }
  }, [comp.slug]);

  // Al abrir el panel, y cada vez que se vuelve al paso de configuración
  // (entre un equipo y el siguiente): así una fila agregada a mitad del
  // evento aparece sola.
  useEffect(() => {
    if (step === "setup") cargarEquipos();
  }, [step, cargarEquipos]);

  /**
   * Elegir equipo completa el proyecto; escribirlo a mano nunca se pisa.
   *
   * Antes esto era un efecto sobre [selectedTeam]. Con la lista viniendo de la
   * planilla, la relectura cambia la referencia de EQUIPOS y el efecto volvía
   * a correr: el proyecto que el operador acababa de tipear —la planilla no
   * tiene esa columna, así que casi siempre lo tipea— se borraba solo.
   * Siendo un handler, sólo cambia cuando la persona cambia de equipo.
   */
  const elegirEquipo = useCallback((nombre: string) => {
    setSelectedTeam(nombre);
    setCustomTeam("");
    setProjectName(EQUIPOS.find((t) => t.name === nombre)?.project || "");
  }, [EQUIPOS]);

  useEffect(() => {
    teamRef.current = activeTeamName;
    projectRef.current = projectName;
  }, [activeTeamName, projectName]);

  /**
   * Dos versiones del transcript, y la diferencia importa.
   *
   * `textoRef` incluye el interim: la frase que Deepgram todavía está
   * corrigiendo mientras la persona la termina de decir. Sirve para mostrarla
   * en pantalla, porque es lo que hace que el texto aparezca al instante.
   *
   * `textoFinalRef` tiene sólo lo ya cerrado, y es el que se guarda, se
   * transmite y se manda al modelo. Con el interim adentro pasaban dos cosas
   * feas:
   *
   *   1. El sync mandaba "…frase a med" y un segundo después llegaba el chunk
   *      final "frase a medias completa", que se AGREGA. La frase quedaba
   *      duplicada en el transcript de la vista AI Judge.
   *   2. El marcado citaba tramos del interim, que después cambiaban al
   *      cerrarse la frase. Esa cita ya no existía literal en el texto y la
   *      marca se descartaba sola: justo las frases más recientes, que son las
   *      que el jurado está mirando, se quedaban sin resaltar.
   */
  useEffect(() => {
    textoRef.current = (transcript.join(" ") + " " + interimText).trim();
    textoFinalRef.current = transcript.join(" ").trim();
  }, [transcript, interimText]);

  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => setSegundos((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);

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
        if (!teamRef.current || !textoRef.current) return;
        localStorage.setItem(
          borradorKey(comp.slug, teamRef.current),
          JSON.stringify({ team: teamRef.current, project: projectRef.current, texto: textoRef.current })
        );
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    try {
      const pendientes = Object.keys(localStorage)
        .filter((k) => k.startsWith(`${BORRADOR_KEY}.${comp.slug}.`))
        .map((k) => {
          try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return null; }
        })
        .filter((b) => b?.texto && b.texto.length > 40);
      if (pendientes.length) {
        setHealth({
          tone: "warn",
          msg: `Borradores sin cerrar: ${pendientes.map((b: any) => b.team).join(", ")}. Se recuperan al iniciar ese equipo.`,
        });
      }
    } catch {}
  }, []);

  const stopAudio = useCallback(() => {
    detenidoAdredeRef.current = true;
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
        body: JSON.stringify({ competencia: comp.slug, team: teamRef.current, project: projectRef.current, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setHealth({ tone: "bad", msg: data.error || `La vista en vivo no recibe (HTTP ${res.status}).` });
        return false;
      }
      setHealth({ tone: "ok", msg: "Transmitiendo a la vista en vivo" });
      return true;
    } catch (e: any) {
      setHealth({ tone: "bad", msg: e?.message || "Error de red al transmitir." });
      return false;
    }
  }, []);

  /**
   * Recalcula los indicadores de la competición y los empuja al canal en vivo.
   *
   * El guard de "en vuelo" importa: si una lectura tarda más que el intervalo,
   * se encimarían dos llamadas y la respuesta vieja podría pisar a la nueva,
   * haciendo que las barras vayan para atrás en pantalla.
   */
  const analizarIndicadores = useCallback(async (texto: string) => {
    if (texto.length < 40 || enVueloRef.current) return;
    enVueloRef.current = true;
    try {
      const res = await fetch("/api/eval-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia: comp.slug,
          team: teamRef.current,
          project: projectRef.current,
          transcript: texto,
          // La lectura anterior: el modelo parte de ahí en vez de puntuar
          // desde cero cada vez, que es lo que hacía saltar los valores.
          previas: metricsRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // El endpoint devuelve las previas cuando falla: no se pierde el estado.
        if (data.metrics) {
          metricsRef.current = data.metrics;
          setMetrics(data.metrics);
        }
        setHealth({ tone: "warn", msg: data.error || "No se pudieron recalcular los indicadores." });
        return;
      }

      if (data.metrics) {
        metricsRef.current = data.metrics;
        setMetrics(data.metrics);
      }
      if (data.broadcastError) setHealth({ tone: "bad", msg: data.broadcastError });
      setUltimoAnalisis(new Date().toLocaleTimeString("es-AR"));
      lecturasRef.current += 1;
      setLecturas(lecturasRef.current);
      largoAnalizadoRef.current = texto.length;
    } catch {
      setHealth({ tone: "warn", msg: "Error de red al analizar indicadores." });
    } finally {
      enVueloRef.current = false;
    }
  }, []);

  /**
   * Marca el transcript para el jurado y propone preguntas de cierre.
   * Vive sólo acá: nunca se transmite al canal en vivo.
   */
  const marcarTranscript = useCallback(async (texto: string) => {
    if (texto.length < 200 || marcasEnVueloRef.current) return;
    marcasEnVueloRef.current = true;
    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia: comp.slug,
          team: teamRef.current,
          project: projectRef.current,
          transcript: texto,
          // Las preguntas se construyen sobre las anteriores: el modelo saca
          // las que el orador ya respondió y suma pocas por vez.
          preguntasPrevias: preguntasRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El marcado es un extra y no corta la grabación, pero callarlo del
        // todo fue un error: si Gemini está rechazando, esto falla junto con
        // los indicadores y el operador veía las barras quietas sin ninguna
        // pista de por qué.
        setHealth({ tone: "warn", msg: data.error || "No se pudieron marcar el transcript ni las preguntas." });
        return;
      }
      if (Array.isArray(data.marcas)) {
        marcasRef.current = data.marcas;
        setMarcas(data.marcas);
      }
      if (Array.isArray(data.preguntas)) {
        preguntasRef.current = data.preguntas;
        setPreguntas(data.preguntas);
      }
      if (Array.isArray(data.resueltas) && data.resueltas.length) {
        setResueltas((prev) => [...prev, ...data.resueltas].slice(-6));
      }
      largoMarcadoRef.current = texto.length;
    } catch {
      // silencioso a propósito
    } finally {
      marcasEnVueloRef.current = false;
    }
  }, []);

  // ── Los latidos que corren mientras se graba ──────────────────

  // 1) El LLM re-evalúa los indicadores cada tanto: es lo que hace que las
  //    barras suban y bajen solas mientras la persona habla.
  useEffect(() => {
    if (!isRecording || !autoAnalisis) return;
    const t = setInterval(() => {
      const texto = textoFinalRef.current;
      if (texto.length - largoAnalizadoRef.current < MIN_TEXTO_NUEVO) return;
      analizarIndicadores(texto);
    }, INTERVALO_ANALISIS_MS);
    return () => clearInterval(t);
  }, [isRecording, autoAnalisis, analizarIndicadores]);

  // 2) Marcado del transcript para el jurado, más espaciado que la medición.
  useEffect(() => {
    if (!isRecording || !autoAnalisis) return;
    const t = setInterval(() => {
      const texto = textoFinalRef.current;
      if (texto.length - largoMarcadoRef.current < MIN_TEXTO_NUEVO * 2) return;
      marcarTranscript(texto);
    }, INTERVALO_MARCAS_MS);
    return () => clearInterval(t);
  }, [isRecording, autoAnalisis, marcarTranscript]);

  // 3) Reenvío del transcript completo, para que la vista en vivo se
  //    corrija sola si perdió algún evento.
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => {
      if (!textoRef.current) return;
      publicar({ mode: "sync", fullText: textoFinalRef.current });
      // Y de paso repara el transcript del servidor: si algún chunk se perdió
      // en el camino, el hueco se tapa acá.
      fetch("/api/fichas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia: comp.slug,
          team: teamRef.current,
          project: projectRef.current,
          fullText: textoFinalRef.current,
          lecturas: lecturasRef.current,
          /**
           * Los indicadores en curso.
           *
           * Iban sólo por Pusher, que llega al canal en vivo pero no queda
           * guardado en ningún lado: el servidor recién los veía en el POST
           * de finalizar. Así, quien abriera el AI Judge a mitad de pitch
           * —que lee del servidor, no del canal— veía los medidores clavados
           * en 50 y recién saltaban al valor real cuando el equipo cerraba.
           */
          metrics: metricsRef.current,
          // Viajan de arrimo en el sync que ya existía: el home las muestra en
          // la vista AI Judge sin pedirle nada al modelo.
          preguntas: preguntasRef.current,
          marcas: marcasRef.current,
        }),
      }).catch(() => {});
    }, INTERVALO_SYNC_MS);
    return () => clearInterval(t);
  }, [isRecording, publicar]);

  const startSession = () => {
    setStep("live");
    setAiAnalysis("");
    setMetrics(null);
    setUltimoAnalisis("");
    setMarcas([]);
    marcasRef.current = [];
    setPreguntas([]);
    setResueltas([]);
    preguntasRef.current = [];
    /**
     * Los indicadores tienen que arrancar en cero para cada equipo.
     *
     * setMetrics(null) limpiaba la pantalla pero metricsRef quedaba con los
     * valores del equipo anterior, y ese ref es el que se usa para dos cosas:
     * se manda como `previas` a la medición —así que el equipo nuevo empezaba
     * a ser juzgado desde el puntaje del anterior— y viaja en el sync, así que
     * el AI Judge lo mostraba con esos números desde el segundo cero, antes de
     * que la IA escuchara una sola palabra. Con el tope de 12 puntos por
     * lectura, salir de un arranque equivocado tomaba varias lecturas.
     */
    metricsRef.current = null;
    setLecturas(0);
    lecturasRef.current = 0;
    setSegundos(0);
    largoAnalizadoRef.current = 0;
    largoMarcadoRef.current = 0;

    // Recuperar borrador si es el mismo equipo
    let recuperado: string[] = [];
    try {
      const raw = localStorage.getItem(borradorKey(comp.slug, activeTeamName));
      if (raw) {
        const b = JSON.parse(raw);
        if (b?.texto) {
          recuperado = [b.texto];
          setHealth({ tone: "warn", msg: "Se recuperó el borrador de este equipo." });
        }
      }
    } catch {}
    setTranscript(recuperado);
    setInterimText("");
  };

  /** Abre micrófono + WebSocket de Deepgram. Se reutiliza al reconectar. */
  const abrirMicrofono = async (esReintento = false) => {
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
        reintentosRef.current = 0;
        setMicCaido(false);
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) socket.send(event.data);
        });
        mediaRecorder.start(250);
        mediaRecorderRef.current = mediaRecorder;
        setHealth({
          tone: "ok",
          msg: esReintento ? "Micrófono reconectado, transcribiendo" : "Micrófono conectado, transcribiendo",
        });
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
              competencia: comp.slug,
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

      // Deepgram puede cortar solo (token vencido, red, inactividad). Antes
      // esto apagaba la grabación en silencio: el operador seguía hablando
      // creyendo que se transcribía y no se registraba nada.
      socket.onclose = () => {
        setIsRecording(false);
        if (detenidoAdredeRef.current) return;

        if (reintentosRef.current < MAX_REINTENTOS_MIC) {
          reintentosRef.current += 1;
          setMicCaido(true);
          setHealth({
            tone: "warn",
            msg: `Se cortó la transcripción. Reconectando (intento ${reintentosRef.current}/${MAX_REINTENTOS_MIC})…`,
          });
          setTimeout(() => {
            if (!detenidoAdredeRef.current) abrirMicrofono(true);
          }, 1200 * reintentosRef.current);
        } else {
          setMicCaido(true);
          setHealth({
            tone: "bad",
            msg: "La transcripción se cortó y no pudo reconectar. Tocá Grabar de nuevo.",
          });
        }
      };

      socketRef.current = socket;
      detenidoAdredeRef.current = false;
      setIsRecording(true);
    } catch (err: any) {
      console.error("Error al iniciar grabación:", err);
      setMicCaido(true);
      setHealth({ tone: "bad", msg: "Error al iniciar audio: " + (err.message || err.toString()) });
      stopAudio();
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopAudio();
      setMicCaido(false);
      if (textoFinalRef.current) publicar({ mode: "sync", fullText: textoFinalRef.current });
      return;
    }
    reintentosRef.current = 0;
    detenidoAdredeRef.current = false;
    await abrirMicrofono(false);
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
          competencia: comp.slug,
          team: activeTeamName,
          project: projectName,
          transcript: texto,
          question: "Evaluar presentación del equipo y sugerir notas",
        }),
      });
      const data = await res.json();
      setAiAnalysis(data.text || data.error || "Análisis completado.");
      await Promise.all([analizarIndicadores(texto), marcarTranscript(texto)]);
    } catch {
      setAiAnalysis("Error en la conexión con la IA de evaluación.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const finishSession = async () => {
    stopAudio();
    setIsFinishing(true);
    // Al cerrar sí entra el interim: es la última frase dicha y ya no va a
    // llegar ningún chunk que la duplique.
    const texto = textoRef.current;
    if (texto) await publicar({ mode: "sync", fullText: texto });

    // La ficha final la escribe el LLM con todo el transcript, en el mismo
    // formato que las fichas de referencia del dashboard. Si falla, seguimos
    // con lo que haya del análisis en vivo: nunca perdemos el pitch por esto.
    let ficha = aiAnalysis;
    let fichaError = "";
    try {
      setHealth({ tone: "warn", msg: "Generando ficha final con la IA…" });
      const res = await fetch("/api/ficha-final", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia: comp.slug,
          team: activeTeamName,
          project: projectName,
          transcript: texto,
          metrics: metricsRef.current,
          lecturas: lecturasRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.raw) {
        ficha = data.raw;
        setAiAnalysis(data.raw);
      } else {
        // El endpoint manda el motivo real en `detail` (ej. "quota exceeded").
        // Antes se descartaba y en pantalla quedaba un "Error en Gemini API"
        // que no le servía a nadie para saber qué arreglar.
        const detalle = typeof data.detail === "string" ? data.detail.slice(0, 220) : "";
        fichaError = [data.error || `El generador respondió ${res.status}.`, detalle]
          .filter(Boolean)
          .join(" · ");
        setHealth({ tone: "bad", msg: `Ficha no generada: ${fichaError}` });
      }
    } catch (e: any) {
      fichaError = e?.message || "Error de red al generar la ficha.";
      setHealth({ tone: "bad", msg: `Ficha no generada: ${fichaError}` });
    }

    try {
      const res = await fetch("/api/fichas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competencia: comp.slug,
          action: "finish",
          team: activeTeamName,
          project: projectName,
          textChunk: interimText,
          analysis: ficha,
          // Si no salió la ficha, el motivo viaja hasta el dashboard:
          // vale más un aviso visible que un hueco silencioso.
          analysisError: ficha ? "" : fichaError,
          metrics: metricsRef.current,
          fullText: texto,
          lecturas: lecturasRef.current,
          // Última foto de preguntas y marcas: quedan pegadas a la ficha.
          preguntas: preguntasRef.current,
          marcas: marcasRef.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.broadcastError) setHealth({ tone: "bad", msg: data.broadcastError });
      else setHealth({ tone: "ok", msg: "Ficha registrada y transmitida" });
    } catch (e) {
      console.error("Error al finalizar ficha:", e);
      setHealth({ tone: "bad", msg: "No se pudo registrar la ficha." });
    }

    try { localStorage.removeItem(borradorKey(comp.slug, activeTeamName)); } catch {}
    setIsFinishing(false);
    setStep("session");
  };

  /**
   * Sesiones guardadas en la base.
   *
   * Se leen cada vez que se vuelve al paso 1: es el único momento en que hay
   * tiempo real para limpiar. Durante el pitch nadie va a estar borrando nada.
   */
  const cargarGuardadas = useCallback(async () => {
    setCargandoGuardadas(true);
    try {
      // Con `?t=` para saltear el cache del CDN: después de borrar una sesión
      // el operador tiene que ver el estado real, no uno de hace tres segundos.
      const res = await fetch(`/api/fichas?competencia=${comp.slug}&t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const todas: Record<string, any> = data.allSessions || {};
      const activo: string | null = data.activeSession?.team || null;

      setDurable(Boolean(data.durable));
      setGuardadas(
        Object.values(todas)
          .map((s: any) => ({
            team: s.team,
            project: s.project || "",
            timestamp: s.timestamp || "",
            isFinished: Boolean(s.isFinished),
            largo: (s.transcript || "").length,
            tieneFicha: Boolean(s.analysis),
            esActiva: s.team === activo,
          }))
          .sort((a, b) => a.team.localeCompare(b.team))
      );
    } catch {
      setGuardadas([]);
    } finally {
      setCargandoGuardadas(false);
    }
  }, []);

  useEffect(() => {
    if (step === "setup") cargarGuardadas();
  }, [step, cargarGuardadas]);

  const borrar = useCallback(
    async (equipo: string | "TODAS") => {
      // La competición es obligatoria acá: sin ella el endpoint cae en la
      // primera del registro, y "borrar todas" limpiaría la base de la OTRA
      // competición en vez de la que el operador tiene abierta.
      const base = `/api/fichas?competencia=${encodeURIComponent(comp.slug)}`;
      const url =
        equipo === "TODAS" ? `${base}&all=1` : `${base}&team=${encodeURIComponent(equipo)}`;
      try {
        const res = await fetch(url, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setHealth({ tone: "bad", msg: data.error || `No se pudo borrar (HTTP ${res.status}).` });
          return;
        }
        setHealth({
          tone: "ok",
          msg:
            equipo === "TODAS"
              ? `Se borraron ${data.borradas} sesión(es). La base quedó limpia.`
              : `Sesión de ${equipo} borrada.`,
        });
        setPorBorrar(null);
        cargarGuardadas();
      } catch (e: any) {
        setHealth({ tone: "bad", msg: e?.message || "Error de red al borrar." });
      }
    },
    [cargarGuardadas]
  );

  const chipClass = health ? `chip chip--${health.tone} chip--msg` : "";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          {/* El logo siempre vuelve al dashboard de ESTA competición */}
          <a href={`/${comp.slug}`} aria-label="Ir al dashboard">
            <img className="topbar__logo" src="/logos argentina/PNG/SIN BAJADA/02.png" alt="eCommerce DAY Argentina" />
          </a>
          <div className="topbar__divider" />
          <div>
            <div className="topbar__title">Copiloto de Evaluación</div>
            {/*
              El nombre de la competición va grande y con su color propio.
              No es decoración: el mismo operador maneja las dos el mismo día
              y el error más caro es abrir el copiloto de la equivocada y
              grabar un pitch contra la base que no era.
            */}
            <div className="topbar__sub">
              <span className="topbar__competencia" style={{ color: comp.acento }}>
                {comp.nombre}
              </span>
              {" · "}
              {comp.evento}
            </div>
          </div>
        </div>
        <div className="topbar__actions">
          {health && <span className={chipClass} title={health.msg}>{health.msg}</span>}
          <a className="btn btn--ghost btn--sm" href={`/${comp.slug}/ai`} target="_blank" rel="noreferrer">
            Vista AI Judge ↗
          </a>
        </div>
      </header>

      {authWarning && (
        <div className="notice notice--warn">
          <span>▲</span>
          <span>
            Este panel está sin contraseña. Definí <strong>ADMIN_PASSWORD</strong> en Vercel para que
            sólo el operador pueda escribir en la pantalla del evento.
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
              {/*
                De dónde salió la lista, dicho en pantalla.
                Si el operador ve nombres que no esperaba, la diferencia entre
                "la planilla está desactualizada" y "Google no respondió y
                estás viendo el respaldo" es la diferencia entre arreglarlo en
                treinta segundos o no entender nada.
              */}
              <div className="label label--row">
                <label htmlFor="equipo">Equipo</label>
                <span className="label__fuente">
                  {cargandoEquipos
                    ? "leyendo la planilla…"
                    : fuenteEquipos === "planilla"
                      ? `${EQUIPOS.length} desde la planilla`
                      : errorEquipos
                        ? "lista de respaldo"
                        : ""}
                  <button
                    type="button"
                    className="btn btn--ghost btn--xs"
                    onClick={cargarEquipos}
                    disabled={cargandoEquipos}
                    title="Volver a leer la planilla"
                  >
                    ↻
                  </button>
                </span>
              </div>
              <select
                id="equipo"
                className="input"
                value={selectedTeam}
                onChange={(e) => elegirEquipo(e.target.value)}
              >
                {EQUIPOS.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              <input
                className="input"
                style={{ marginTop: 10 }}
                type="text"
                placeholder="O escribí otro nombre…"
                value={customTeam}
                onChange={(e) => setCustomTeam(e.target.value)}
              />
              {errorEquipos && (
                <div className="soft" style={{ fontSize: "var(--fs-micro)", marginTop: 8 }}>
                  ▲ No se pudo leer la planilla ({errorEquipos}) — estás viendo la lista de
                  respaldo. Podés escribir el nombre a mano igual.
                </div>
              )}
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

          {/*
            Sin nombre de equipo no se puede arrancar.
            Antes la lista estaba hardcodeada y siempre tenía al menos uno, así
            que la guarda no hacía falta. Ahora viene de la planilla: si el
            Sheet no responde y el registro no tiene respaldo, el selector
            queda vacío y `activeTeamName` es "". Arrancar así deja al operador
            grabando mientras cada POST rebota con 400 y la sala no ve nada.
          */}
          <button
            className="btn btn--primary btn--block"
            onClick={startSession}
            disabled={!activeTeamName.trim()}
          >
            {activeTeamName.trim()
              ? `🎙️ Iniciar evaluación de ${activeTeamName}`
              : "Elegí un equipo o escribí un nombre para empezar"}
          </button>

          {/* Sesiones guardadas. Vive acá y no en el home a propósito: el home
              es público y no tiene contraseña, así que un botón de borrar ahí
              lo podría tocar cualquiera desde la sala. Lo que se borra desde
              este panel desaparece del AI Judge en el siguiente refresco. */}
          <div className="guardadas">
            <div className="section-head">
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">Sesiones guardadas</div>
                <div className="soft" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>
                  {durable === false
                    ? "Sin base configurada: esto no sobrevive a un redeploy."
                    : `Lo que borrás acá desaparece del dashboard de ${comp.nombreCorto}. La otra competición no se toca.`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn--ghost btn--sm" onClick={cargarGuardadas} disabled={cargandoGuardadas}>
                  {cargandoGuardadas ? "…" : "↻"}
                </button>
                {guardadas.length > 0 &&
                  (porBorrar === "TODAS" ? (
                    <>
                      <button className="btn btn--danger btn--sm" onClick={() => borrar("TODAS")}>
                        Sí, borrar las {guardadas.length}
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={() => setPorBorrar(null)}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button className="btn btn--ghost btn--sm" onClick={() => setPorBorrar("TODAS")}>
                      Borrar todas
                    </button>
                  ))}
              </div>
            </div>

            {guardadas.length === 0 ? (
              <div className="soft" style={{ fontSize: "var(--fs-sm)", padding: "10px 0" }}>
                {cargandoGuardadas ? "Buscando…" : "No hay ninguna sesión guardada todavía."}
              </div>
            ) : (
              <ul className="guardadas__lista">
                {guardadas.map((s) => (
                  <li className="guardada" key={s.team}>
                    <div className="guardada__id">
                      <span className="guardada__nombre">{s.team}</span>
                      <span className="guardada__meta">
                        {[
                          s.project,
                          s.esActiva ? "● presentando ahora" : s.isFinished ? "cerrada" : "sin cerrar",
                          s.tieneFicha ? "con ficha" : "sin ficha",
                          `${s.largo.toLocaleString("es-AR")} caracteres`,
                          s.timestamp,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {porBorrar === s.team ? (
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button className="btn btn--danger btn--sm" onClick={() => borrar(s.team)}>
                          Sí, borrar
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => setPorBorrar(null)}>
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => setPorBorrar(s.team)}
                        aria-label={`Borrar la sesión de ${s.team}`}
                        style={{ flexShrink: 0 }}
                      >
                        Borrar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {step === "live" && (
        <div className="console">
          <section className="card console__panel">
            <div className="section-head">
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">{isRecording ? "● Grabando" : "En vivo"}</div>
                <h3 style={{ marginTop: 3 }}>{activeTeamName}</h3>
                <div className="ficha__proj">{projectName}</div>
              </div>
              {/* El cronómetro del pitch: el operador necesita saber cuánto
                  lleva hablando el equipo sin mirar el reloj del celular. */}
              <div className="pitch-reloj mono" title="Tiempo de este pitch">
                {String(Math.floor(segundos / 60)).padStart(2, "0")}:
                {String(segundos % 60).padStart(2, "0")}
              </div>
            </div>

            {micCaido && (
              <div className="notice notice--bad" style={{ marginBottom: 12 }}>
                <span>▲</span>
                <span>Se cortó la transcripción. Revisá el chip de estado arriba.</span>
              </div>
            )}

            {marcas.length > 0 && (
              <LeyendaMarcas
                conteo={{
                  dato: marcas.filter((m) => m.tipo === "dato").length,
                  demo: marcas.filter((m) => m.tipo === "demo").length,
                  flojo: marcas.filter((m) => m.tipo === "flojo").length,
                }}
              />
            )}

            <div className="transcript transcript--op" ref={transcriptBoxRef}>
              {transcript.length === 0 && !interimText ? (
                <div className="transcript__empty">
                  {isRecording ? "Escuchando…" : "Tocá Grabar para empezar a transcribir."}
                </div>
              ) : (
                <TranscriptMarcado
                  texto={transcript.join(" ")}
                  interim={interimText}
                  marcas={marcas}
                />
              )}
            </div>

            {/* Todos los controles juntos y en el orden en que se usan:
                primero grabar, después analizar, al final cerrar. El de grabar
                manda, porque es el que decide si el sistema está capturando. */}
            <div className="console__actions">
              <button
                className={`btn console__rec ${isRecording ? "btn--stop" : "btn--rec"}`}
                onClick={toggleRecording}
                disabled={isFinishing}
              >
                {isRecording ? "⏹  Detener micrófono" : "🎙  Grabar micrófono"}
              </button>

              <button
                className="btn btn--ghost"
                onClick={analizarPitch}
                disabled={isAnalyzing || isFinishing}
              >
                {isAnalyzing ? "✨ Analizando…" : "✨ Analizar"}
              </button>

              <button className="btn btn--ghost" onClick={finishSession} disabled={isFinishing}>
                {isFinishing ? "⏳ Generando ficha…" : "💾 Finalizar"}
              </button>
            </div>
          </section>

          <section className="card console__panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">Análisis</div>
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

            {/* Los indicadores viven en la vista AI Judge, que es donde se
                miran. Repetirlos acá era ruido: al operador le alcanza con
                saber que el análisis está corriendo. */}
            <div style={{ fontSize: "var(--fs-micro)" }} className="muted mono">
              {isRecording && autoAnalisis
                ? `Re-analizando indicadores cada ${INTERVALO_ANALISIS_MS / 1000}s · último: ${ultimoAnalisis || "—"}`
                : "Análisis automático en pausa"}
            </div>

            {preguntas.length > 0 && (
              <div style={{ margin: "var(--gap) 0" }}>
                <span className="ficha__tag" style={{ color: "var(--brand)" }}>
                  Preguntas para el cierre · se suman a medida que avanza
                </span>
                <div className="preguntas">
                  {preguntas.map((q, i) => (
                    <div className="preguntas__item" key={q}>
                      <span className="preguntas__n">{i + 1}</span>
                      <span>{q}</span>
                    </div>
                  ))}
                  {resueltas.slice(-2).map((q) => (
                    <div className="preguntas__item preguntas__item--resuelta" key={`r-${q}`}>
                      <span className="preguntas__n">✓</span>
                      <span>{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              className={`ficha__body${aiAnalysis ? " ficha__body--ai" : ""}`}
              style={{ marginTop: "var(--gap)", maxHeight: "none", flex: 1, overflowY: "auto" }}
            >
              {aiAnalysis ? (
                <>
                  <span className="ficha__tag" style={{ color: "var(--brand)" }}>Evaluación de la IA</span>
                  <FichaTexto raw={aiAnalysis} />
                </>
              ) : (
                <div className="transcript__empty" style={{ padding: "8% 0" }}>
                  Los {comp.indicadores.length} indicadores se mueven solos en la vista AI Judge.
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
              El transcript de {activeTeamName} quedó registrado en {comp.nombreCorto}.
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
