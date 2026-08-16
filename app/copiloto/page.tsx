"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import TranscriptMarcado, { LeyendaMarcas, Marca, TipoMarca } from "../components/TranscriptMarcado";

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

/** Cada cuánto el LLM re-evalúa los indicadores mientras la persona habla.
 *  12s da unas 50 lecturas en un pitch de 10 minutos: suficiente para que la
 *  pantalla pública tenga siempre un tramo nuevo que recorrer. */
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
const borradorKey = (equipo: string) => `${BORRADOR_KEY}.${equipo}`;

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

export default function CopilotoPage() {
  const [step, setStep] = useState<"setup" | "live">("setup");
  const [selectedTeam, setSelectedTeam] = useState(TEAMS_DEFAULT[0].name);
  const [customTeam, setCustomTeam] = useState("");
  const [projectName, setProjectName] = useState(TEAMS_DEFAULT[0].project);

  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [interimText, setInterimText] = useState("");
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

  /** Equipos cuya ficha se está escribiendo ahora mismo, en segundo plano. */
  const [pendientes, setPendientes] = useState<string[]>([]);

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

  useEffect(() => {
    const found = TEAMS_DEFAULT.find((t) => t.name === selectedTeam);
    if (found) setProjectName(found.project);
  }, [selectedTeam]);

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
   *      duplicada en el transcript de la pantalla pública y del AI Judge.
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
          borradorKey(teamRef.current),
          JSON.stringify({ team: teamRef.current, project: projectRef.current, texto: textoRef.current })
        );
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    try {
      const pendientes = Object.keys(localStorage)
        .filter((k) => k.startsWith(BORRADOR_KEY + "."))
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

  /**
   * Recalcula los 6 indicadores y los empuja a la pantalla pública.
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
   * Vive sólo acá: nunca se transmite a la pantalla pública.
   */
  const marcarTranscript = useCallback(async (texto: string) => {
    if (texto.length < 200 || marcasEnVueloRef.current) return;
    marcasEnVueloRef.current = true;
    try {
      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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

  // 3) Reenvío del transcript completo, para que la pantalla pública se
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
          team: teamRef.current,
          project: projectRef.current,
          fullText: textoFinalRef.current,
          lecturas: lecturasRef.current,
          /**
           * Los indicadores en curso.
           *
           * Iban sólo por Pusher, que le llega a /publico pero no queda
           * guardado en ningún lado: el servidor recién los veía en el POST
           * de finalizar. Así, el AI Judge del home —que lee del servidor,
           * no del canal— mostraba los seis medidores clavados en 50
           * durante todo el pitch y recién saltaban al valor real cuando el
           * equipo cerraba.
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
    /**
     * Avisarle al servidor que este equipo arranca de cero.
     *
     * Antes no se avisaba nada: la sesión del servidor nacía sola con el
     * primer chunk de audio. Si ese equipo ya existía —el ensayo del
     * micrófono, un pitch que se cortó y se rehizo, una ficha que salió mal y
     * se quiso repetir— el texto nuevo se agregaba abajo del viejo y la ficha
     * final terminaba escrita sobre los dos pitches pegados.
     *
     * Va sin `await` a propósito: la pantalla tiene que pasar a "live" al
     * instante, y si el POST falla el operador se entera por el chip de
     * estado en vez de quedarse mirando un botón que no responde.
     */
    const equipo = activeTeamName;
    fetch("/api/fichas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", team: equipo, project: projectName }),
    })
      .then((r) => {
        if (!r.ok) {
          setHealth({
            tone: "warn",
            msg: `No se pudo abrir la sesión de ${equipo} en el servidor (HTTP ${r.status}). Si ya presentó antes, el texto viejo puede quedar pegado.`,
          });
        }
      })
      .catch(() => {
        setHealth({
          tone: "warn",
          msg: "No se pudo abrir la sesión en el servidor. Revisá la conexión antes de arrancar.",
        });
      });

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
      const raw = localStorage.getItem(borradorKey(activeTeamName));
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

  /**
   * Escribe la ficha del equipo que acaba de cerrar, sin bloquear nada.
   *
   * Corre suelta: nadie la espera. Recibe todo por parámetro —no lee ni un ref—
   * justo porque para cuando el modelo conteste el operador puede estar
   * grabando a otro equipo.
   *
   * Cuando termina, la ficha entra por `action: "ficha"`, que la pega a un
   * pitch ya cerrado sin tocar quién está presentando. Con un POST normal, el
   * servidor daría por cerrado al equipo que está en el escenario en ese
   * momento y se declararía activo el que ya terminó.
   */
  const generarFichaEnSegundoPlano = useCallback(
    async (
      equipo: string,
      proyecto: string,
      texto: string,
      metricas: Record<string, number> | null,
      lecturas: number
    ) => {
      setPendientes((prev) => (prev.includes(equipo) ? prev : [...prev, equipo]));

      let ficha = "";
      let fichaError = "";
      let aviso: Health = null;

      try {
        const res = await fetch("/api/ficha-final", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team: equipo, project: proyecto, transcript: texto, metrics: metricas, lecturas }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.raw) {
          ficha = data.raw;
          // La ficha puede venir sin el veredicto final: se guarda igual —es el
          // 90% del documento— pero el operador tiene que saberlo, porque es lo
          // único que se arregla volviendo a generarla.
          aviso = data.incompleta
            ? { tone: "warn", msg: `${equipo}: ${data.motivo || "la ficha quedó incompleta."}` }
            : { tone: "ok", msg: `Ficha de ${equipo} lista` };
        } else {
          // El endpoint manda el motivo real en `detail` (ej. "quota exceeded").
          // Antes se descartaba y en pantalla quedaba un "Error en Gemini API"
          // que no le servía a nadie para saber qué arreglar.
          const detalle = typeof data.detail === "string" ? data.detail.slice(0, 220) : "";
          fichaError = [data.error || `El generador respondió ${res.status}.`, detalle]
            .filter(Boolean)
            .join(" · ");
          aviso = { tone: "bad", msg: `Ficha de ${equipo} no generada: ${fichaError}` };
        }
      } catch (e: any) {
        fichaError = e?.message || "Error de red al generar la ficha.";
        aviso = { tone: "bad", msg: `Ficha de ${equipo} no generada: ${fichaError}` };
      }

      try {
        await fetch("/api/fichas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ficha",
            team: equipo,
            analysis: ficha,
            // Si no salió la ficha, el motivo viaja hasta la pantalla pública:
            // vale más un aviso visible que un hueco silencioso.
            analysisError: ficha ? "" : fichaError,
          }),
        });
      } catch {
        aviso = { tone: "bad", msg: `La ficha de ${equipo} se generó pero no se pudo guardar.` };
      }

      setPendientes((prev) => prev.filter((t) => t !== equipo));
      if (aviso) setHealth(aviso);
    },
    []
  );

  /**
   * Aviso al cerrar la pestaña con fichas a medio escribir.
   *
   * La generación vive en este navegador: si se cierra la pestaña antes de que
   * el modelo conteste, esa ficha se pierde y el equipo queda en el historial
   * sin evaluación. El pitch y la medición no se pierden —esos ya están
   * guardados— pero la ficha hay que volver a generarla a mano.
   */
  useEffect(() => {
    if (!pendientes.length) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pendientes]);

  const finishSession = async () => {
    stopAudio();
    setIsFinishing(true);

    /**
     * Todo lo del equipo que cierra, congelado ANTES de soltar la pantalla.
     *
     * Es lo que hace posible que la ficha se genere en segundo plano: para
     * cuando el modelo conteste, el operador ya puede haber elegido el equipo
     * siguiente y `teamRef`, `metricsRef` y compañía van a estar apuntando a
     * ESE otro pitch. Leerlos después mezclaría los dos equipos.
     */
    const equipo = activeTeamName;
    const proyecto = projectName;
    // Al cerrar sí entra el interim: es la última frase dicha y ya no va a
    // llegar ningún chunk que la duplique.
    const texto = textoRef.current;
    const metricasCierre = metricsRef.current;
    const lecturasCierre = lecturasRef.current;
    const preguntasCierre = preguntasRef.current;
    const marcasCierre = marcasRef.current;
    const ultimoInterim = interimText;

    /**
     * PRIMERA MITAD — cierra el pitch YA.
     *
     * Antes esto era una sola función con tres llamadas en fila, y la del
     * medio es el modelo escribiendo la ficha entera: son varios segundos, y
     * más ahora que la escribe el modelo bueno con razonamiento. Durante todo
     * ese rato los tres botones quedaban deshabilitados. O sea que el operador
     * no podía ni preparar el equipo siguiente ni volver a grabar, parado
     * frente a la sala, esperando un texto que nadie estaba mirando todavía.
     *
     * Ahora el cierre es sólo esto: el transcript final a la pantalla pública
     * y el pitch marcado como cerrado. Menos de un segundo.
     */
    if (texto) await publicar({ mode: "sync", fullText: texto });

    try {
      const res = await fetch("/api/fichas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          team: equipo,
          project: proyecto,
          textChunk: ultimoInterim,
          metrics: metricasCierre,
          fullText: texto,
          lecturas: lecturasCierre,
          // Última foto de preguntas y marcas: quedan pegadas a la ficha.
          preguntas: preguntasCierre,
          marcas: marcasCierre,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.broadcastError) setHealth({ tone: "bad", msg: data.broadcastError });
    } catch (e) {
      console.error("Error al cerrar el pitch:", e);
      setHealth({ tone: "bad", msg: "No se pudo cerrar el pitch en el servidor." });
    }

    try { localStorage.removeItem(borradorKey(equipo)); } catch {}

    // SEGUNDA MITAD: sin await. La ficha se escribe sola mientras el operador
    // ya está en el paso 1 eligiendo al que sigue.
    generarFichaEnSegundoPlano(equipo, proyecto, texto, metricasCierre, lecturasCierre);

    setIsFinishing(false);
    // Directo al paso 1: lo que el operador necesita después de cerrar es
    // elegir el equipo siguiente, no una pantalla de confirmación.
    setStep("setup");
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
      // `full=1` porque acá hace falta el listado entero con su transcript
      // para poder decidir qué borrar; el `?t=` saltea el cache del CDN,
      // porque después de borrar hay que ver el estado real y no uno de hace
      // tres segundos. Son dos máquinas contadas las que piden esta versión.
      const res = await fetch(`/api/fichas?full=1&t=${Date.now()}`, { cache: "no-store" });
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
      const url =
        equipo === "TODAS" ? "/api/fichas?all=1" : `/api/fichas?team=${encodeURIComponent(equipo)}`;
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
          {/* El logo siempre vuelve al dashboard */}
          <a href="/" aria-label="Ir al dashboard">
            <img className="topbar__logo" src="/logos argentina/PNG/SIN BAJADA/02.png" alt="eCommerce DAY Argentina" />
          </a>
          <div className="topbar__divider" />
          <div>
            <div className="topbar__title">Copiloto de Evaluación</div>
            <div className="topbar__sub">eCommerce StartUp Competition · Argentina 2026</div>
          </div>
        </div>
        <div className="topbar__actions">
          {/* Que la ficha se escriba sola no puede significar que se escriba a
              escondidas: el operador tiene que poder ver que sigue trabajando
              mientras él ya está con el equipo siguiente. */}
          {pendientes.length > 0 && (
            <span
              className="chip chip--warn chip--msg"
              title={`Generando la ficha de: ${pendientes.join(", ")}. No cierres esta pestaña.`}
            >
              ⏳ Escribiendo ficha{pendientes.length > 1 ? "s" : ""} de {pendientes.join(", ")}
            </span>
          )}
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

          <button className="btn btn--primary btn--block" onClick={startSession}>
            🎙️ Iniciar evaluación de {activeTeamName}
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
                    : "Lo que borrás acá desaparece del dashboard y de la pantalla pública."}
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

            {/* Dos botones y nada más: grabar y cerrar.
                Había un tercero, "Analizar", que pedía un análisis narrativo a
                mitad del pitch. Sobraba: los indicadores y las preguntas ya se
                recalculan solos cada 12 y 24 segundos, y el veredicto escrito
                lo genera "Finalizar" con un modelo mejor y un formato que el
                dashboard sabe dibujar. Peor todavía, si la ficha final fallaba
                se guardaba ese análisis a medio pitch EN SU LUGAR, con otro
                formato y sin decir que era parcial. */}
            <div className="console__actions">
              <button
                className={`btn console__rec ${isRecording ? "btn--stop" : "btn--rec"}`}
                onClick={toggleRecording}
                disabled={isFinishing}
              >
                {isRecording ? "⏹  Detener micrófono" : "🎙  Grabar micrófono"}
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

            {/* Los 6 indicadores viven en la pantalla pública, que es donde se
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

            {/* Este panel muestra el estado del análisis y las preguntas para
                el cierre, que es lo que el jurado usa mientras el equipo habla.
                La ficha escrita ya no se dibuja acá: se genera en segundo plano
                al tocar «Finalizar» y se lee en el dashboard y en la pantalla
                pública, que es donde alguien la va a mirar. */}
            {preguntas.length === 0 && (
              <div className="transcript__empty" style={{ padding: "8% 0", flex: 1 }}>
                Los 6 indicadores se mueven solos en la pantalla pública.
                <br />
                Las preguntas para el cierre van a aparecer acá.
              </div>
            )}
          </section>
        </div>
      )}

    </div>
  );
}
