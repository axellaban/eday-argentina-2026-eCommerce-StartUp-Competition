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

export const PUSHER_CHANNEL = "eday-pitch-channel";

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

/** Cluster por defecto: sa1 (São Paulo), el más cercano para Argentina. */
export const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "sa1";

/** La key de Pusher es pública por diseño (viaja al navegador). */
export const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || "";
