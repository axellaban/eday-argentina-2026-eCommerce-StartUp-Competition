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
  transcript: "live-transcript",
  metrics: "live-metrics",
  finish: "finish-pitch",
} as const;

/** Cluster por defecto: sa1 (São Paulo), el más cercano para Argentina. */
export const PUSHER_CLUSTER = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "sa1";

/** La key de Pusher es pública por diseño (viaja al navegador). */
export const PUSHER_KEY = process.env.NEXT_PUBLIC_PUSHER_KEY || "";
