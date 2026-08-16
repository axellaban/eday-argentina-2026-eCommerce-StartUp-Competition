import { NextResponse } from "next/server";
import { broadcast } from "@/lib/pusher";
import { MAX_TRANSCRIPT_EVENTO, PUSHER_EVENTS } from "@/lib/pusher-config";
import { loadSessions, saveSessions, isDurable, fuenteUltimaLectura, TeamSession } from "@/lib/store";

// El estado cambia en cada pitch: nunca cachear esta ruta.
export const dynamic = "force-dynamic";

/**
 * Cuánto transcript viaja en la respuesta liviana de una ficha ya cerrada.
 *
 * Es exactamente lo que el AI Judge llega a mostrar cuando un pitch quedó sin
 * ficha: un asomo del texto abajo del aviso de error. Más que eso no se
 * dibuja en ningún lado.
 */
const ASOMO_TRANSCRIPT = 600;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const team = searchParams.get("team");
  const completo = searchParams.get("full") === "1";
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

  /**
   * Dos tamaños de respuesta, y la diferencia no es cosmética.
   *
   * Medido con diez equipos cerrados, la respuesta completa pesa 201 KB: 78 KB
   * de transcripts dentro de `finishedSessions` y los mismos transcripts otra
   * vez adentro de `allSessions`. El AI Judge pide esto cada 5 a 15 segundos
   * desde cada celular de la sala, así que a media jornada cada teléfono se
   * estaba bajando decenas de megas de texto que la pantalla ni usa —el cuerpo
   * de una ficha cerrada sale de `analysis`, no del transcript— y todo eso
   * compite por el wifi del venue con el audio que el copiloto le manda a
   * Deepgram.
   *
   * Por defecto, entonces, va la versión liviana: sin `allSessions` y con un
   * asomo del transcript en vez del transcript entero. Con `?full=1` va todo,
   * para los dos únicos clientes que lo necesitan y que son una máquina cada
   * uno: la pantalla de sala (que arma el respaldo descargable) y el panel del
   * operador (que lista lo guardado para borrarlo).
   *
   * El pitch EN CURSO viaja completo siempre: es uno solo, y es el texto que
   * se está leyendo en pantalla.
   */
  const cerradas = completo
    ? finishedList
    : finishedList.map(({ transcript, marcas, ...resto }) => ({
        ...resto,
        // `marcas` no viaja: el resaltado del transcript es del pitch EN CURSO
        // y ninguna ficha ya cerrada lo dibuja. Son catorce citas por equipo
        // que se estaban mandando cada cinco segundos para no pintar nada.
        transcriptAsomo: (transcript || "").slice(0, ASOMO_TRANSCRIPT),
        transcriptLargo: (transcript || "").length,
      }));

  /**
   * Tres segundos de cache en el CDN.
   *
   * Esta ruta la consulta el home de cada persona que esté mirando. Sin cache,
   * cada consulta es una lectura de Redis: con la sala llena son miles por
   * minuto contra un plan gratuito, y si se agota la cuota se cae la
   * persistencia en pleno evento. Con el cache, el gasto no depende de cuánta
   * gente esté mirando.
   *
   * Tres segundos no se notan: el canal en vivo ya entrega lo urgente al
   * instante, y esto es la red de seguridad. El operador saltea el cache
   * agregando `?t=`, que hace única la URL, porque después de borrar una
   * sesión necesita ver el estado real.
   */
  return NextResponse.json(
    {
      activeSession,
      finishedSessions: cerradas,
      ...(completo ? { allSessions: data.sessions } : {}),
      durable: isDurable(),
      /**
       * Esta respuesta salió de la base, no del disco de una instancia.
       * Es la única condición bajo la cual un cliente puede tratar la ausencia
       * de una ficha como "la borraron" y no como "esta instancia no la vio".
       */
      leidoDeLaBase: fuenteUltimaLectura() === "kv",
    },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=10" } }
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, team, project, textChunk, fullText, analysis, analysisError, metrics, lecturas, preguntas, marcas } = body;

    if (!team) {
      return NextResponse.json({ error: "Falta el nombre del equipo" }, { status: 400 });
    }

    const data = await loadSessions();

    const enBlanco = (): TeamSession => ({
      team,
      project: project || "",
      transcript: "",
      isFinished: false,
      timestamp: new Date().toLocaleTimeString("es-AR"),
      updatedAt: Date.now(),
    });

    /**
     * "start": este equipo arranca de cero, ahora.
     *
     * Sin esta acción, el copiloto no le avisaba nada al servidor al empezar:
     * la sesión nacía sola con el primer chunk de audio. Y si ese equipo ya
     * existía —porque se ensayó el micrófono con ese nombre, porque el pitch
     * se cortó y se volvió a empezar, o porque se rehizo una ficha que salió
     * mal— el chunk nuevo se AGREGABA al texto viejo. El resultado era un
     * transcript con el ensayo pegado adelante del pitch real, la ficha del
     * intento anterior colgando, y la ficha final generada sobre los dos
     * textos mezclados.
     *
     * Reiniciar acá es lo correcto y no pierde nada que importe: si alguien
     * arranca un equipo es porque va a hablar de nuevo, y lo anterior o ya se
     * descartó o ya se descargó.
     */
    if (action === "start" || !data.sessions[team]) {
      data.sessions[team] = enBlanco();
    }

    const session = data.sessions[team];

    if (project) session.project = project;

    /**
     * Agregar el chunk, pero sólo si no está ya.
     *
     * Los chunks se mandan apenas Deepgram cierra una frase y el sync manda
     * todo el texto cada 12s. Si un chunk se demora en la red y aterriza
     * DESPUÉS del sync que ya lo incluía, se agregaba de nuevo: la frase
     * quedaba repetida en la pantalla pública y en el AI Judge.
     *
     * Si la frase se dijo dos veces seguidas de verdad, el próximo sync trae el
     * texto completo con las dos y, por ser más largo, lo restituye acá abajo.
     * Descartar de más se corrige solo; duplicar no.
     */
    if (textChunk) {
      const chunk = String(textChunk);
      if (!session.transcript.endsWith(chunk)) {
        session.transcript += (session.transcript ? " " : "") + chunk;
        session.updatedAt = Date.now();
      }
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

    if (Array.isArray(marcas)) {
      session.marcas = marcas
        .filter((m: any) => m && typeof m.cita === "string" && m.cita.length >= 12)
        .map((m: any) => ({ cita: String(m.cita), tipo: String(m.tipo) }))
        .slice(0, 14);
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

      /**
       * Un pitch cerrado no se reabre por un POST que llegó tarde.
       *
       * Antes, cualquier POST sin `action` ponía `isFinished = false` y volvía
       * a marcar el equipo como activo. Alcanzaba con que un chunk de audio o
       * el sync de cada 12s se demorara en la red y aterrizara después del
       * "Finalizar" para que el equipo desapareciera de las fichas cerradas y
       * quedara colgado como "presentando ahora" — y nada lo volvía a cerrar,
       * porque el operador ya había pasado al siguiente. Reproducido: bastaba
       * un sync tardío para que `finishedSessions` quedara vacío.
       *
       * Ahora sólo `action: "start"` abre un pitch. Un POST tardío sobre algo
       * ya cerrado sigue aportando su texto —es texto de ese mismo pitch— pero
       * no lo resucita.
       */
      if (!session.isFinished) data.activeTeam = team;
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

/**
 * Borra sesiones guardadas.
 *
 * Existe porque los ensayos quedan mezclados con lo real: se prueba el
 * micrófono con "Equipo Test", se corta un pitch a la mitad, se arranca dos
 * veces el mismo equipo. Antes de que empiece el evento hay que poder dejar la
 * base limpia sin entrar a Upstash a mano.
 *
 *   DELETE /api/fichas?team=Nombre  → borra esa sesión
 *   DELETE /api/fichas?all=1        → borra todas
 *
 * Sólo el operador puede llamarlo: el middleware deja pasar sin contraseña
 * únicamente el GET de esta ruta. La pantalla pública y el AI Judge del home
 * leen del mismo store, así que lo borrado desaparece solo de ahí.
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const team = searchParams.get("team");
    const todas = searchParams.get("all") === "1";

    if (!team && !todas) {
      return NextResponse.json(
        { error: "Indicá ?team=Nombre o ?all=1." },
        { status: 400 }
      );
    }

    const data = await loadSessions();

    if (todas) {
      const borradas = Object.keys(data.sessions).length;
      data.sessions = {};
      data.activeTeam = null;
      await saveSessions(data);
      return NextResponse.json({ success: true, borradas, durable: isDurable() });
    }

    if (!data.sessions[team!]) {
      return NextResponse.json({ error: "Ese equipo no está guardado." }, { status: 404 });
    }

    delete data.sessions[team!];
    // Si era el que estaba presentando, deja de estarlo: si no, el home se
    // queda mostrando "presentando ahora" un equipo que ya no existe.
    if (data.activeTeam === team) data.activeTeam = null;

    await saveSessions(data);
    return NextResponse.json({ success: true, borradas: 1, team, durable: isDurable() });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Error al borrar la sesión." },
      { status: 500 }
    );
  }
}
