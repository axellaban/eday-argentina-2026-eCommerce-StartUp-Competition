/**
 * Config de Pusher compartida entre cliente y servidor.
 *
 * Antes el default del servidor era el cluster "us2" con credenciales "demo-*",
 * y el del cliente era el cluster "sa1" con una key hardcodeada: si faltaba
 * alguna env var, los dos lados quedaban apuntando a lugares distintos y el
 * trigger fallaba con 403 sin que nadie lo viera. Ahora hay un solo default.
 *
 * Este archivo NO puede importar el SDK de servidor: lo consumen componentes
 * "use client".
 */

/**
 * Un canal por competición.
 *
 * Antes era una constante única. Con dos competiciones el mismo día eso
 * significa que la pantalla de sala de la primera —que nadie cierra cuando
 * termina— empieza a mostrar los subtítulos en vivo de la segunda. Separar el
 * canal elimina esa clase de error entera, aunque las competiciones corran una
 * después de la otra.
 */
export function canalDe(slug: string): string {
  return `eday-pitch-${slug}`;
}

export const PUSHER_EVENTS = {
  /** Cada frase cerrada, para que los subtítulos aparezcan al instante. */
  transcript: "live-transcript",
  /**
   * Transcript COMPLETO acumulado, cada pocos segundos. Los eventos sueltos
   * pueden perderse (red, pestaña dormida, viewer que entra tarde) y entonces
   * la pantalla pública queda con el texto incompleto. Este evento reemplaza
   * todo el texto en vez de sumar, así se corrige solo.
   */
  sync: "sync-transcript",
  metrics: "live-metrics",
  finish: "finish-pitch",
} as const;

/**
 * Tope de transcript que viaja dentro de un evento.
 *
 * Pusher corta los mensajes de más de 10 KB. Un pitch de 10 minutos son unos
 * 7.800 caracteres y la ficha suma otros 2.200: el evento de cierre quedaba en
 * ~10.000 bytes, al borde. En las presentaciones más largas —justo las que más
 * importan— el evento se habría perdido entero.
 *
 * Se manda sólo la cola. No se pierde nada: la pantalla pública viene
 * acumulando el texto frase por frase desde que arrancó el pitch, así que ya
 * tiene el transcript completo y se queda con el más largo de los dos.
 */
export const MAX_TRANSCRIPT_EVENTO = 5000;

/** Cluster por defecto: sa1 (São Paulo), el más cercano para Argentina. */
export const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "sa1";

/** La key de Pusher es pública por diseño (viaja al navegador). */
export const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || "";
