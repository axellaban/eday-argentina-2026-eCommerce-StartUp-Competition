import PusherServer from "pusher";
import { PUSHER_CHANNEL, PUSHER_CLUSTER } from "./pusher-config";

/**
 * Cliente de Pusher del lado servidor.
 *
 * Antes se construía siempre, con credenciales "demo-*" cuando faltaban las env
 * vars, y recién fallaba al hacer trigger (403). Ahora devolvemos null si no
 * está configurado, para que cada endpoint pueda responder un error explícito.
 */

const appId = process.env.PUSHER_APP_ID || "";
const key = process.env.NEXT_PUBLIC_PUSHER_KEY || "";
const secret = process.env.PUSHER_SECRET || "";

export function isPusherConfigured(): boolean {
  return Boolean(appId && key && secret);
}

let cached: PusherServer | null = null;

export function getPusherServer(): PusherServer | null {
  if (!isPusherConfigured()) return null;
  if (!cached) {
    cached = new PusherServer({
      appId,
      key,
      secret,
      cluster: PUSHER_CLUSTER,
      useTLS: true,
    });
  }
  return cached;
}

/**
 * Emite un evento al canal de la competencia.
 * Devuelve un resultado en vez de tirar, así los endpoints deciden si el fallo
 * de transmisión es fatal (transcripción en vivo) o tolerable (fin de pitch).
 */
export async function broadcast(
  event: string,
  payload: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pusher = getPusherServer();
  if (!pusher) {
    return {
      ok: false,
      error:
        "Pusher no está configurado. Faltan PUSHER_APP_ID, PUSHER_SECRET o NEXT_PUBLIC_PUSHER_KEY.",
    };
  }
  try {
    await pusher.trigger(PUSHER_CHANNEL, event, payload);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Error transmitiendo por Pusher." };
  }
}
