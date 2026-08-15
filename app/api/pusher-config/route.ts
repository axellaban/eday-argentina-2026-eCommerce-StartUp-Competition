import { NextResponse } from "next/server";
import { PUSHER_CHANNEL, PUSHER_CLUSTER, PUSHER_EVENTS, PUSHER_KEY } from "@/lib/pusher-config";

export const dynamic = "force-dynamic";

/**
 * Config pública del canal en tiempo real.
 *
 * El dashboard del home es un HTML estático servido tal cual, sin bundler y
 * sin proceso de build: no hay forma de inyectarle NEXT_PUBLIC_PUSHER_KEY como
 * se hace en /publico. Por eso la pide acá.
 *
 * No expone nada secreto. La key de Pusher es pública por diseño —viaja al
 * navegador en cualquier cliente— y sólo sirve para suscribirse a un canal
 * público y ESCUCHAR. Publicar requiere PUSHER_SECRET, que vive únicamente en
 * el servidor y no sale nunca de acá.
 *
 * Se cachea 5 minutos en el CDN: esto no cambia entre pitches, y sin cache
 * cada visitante del home pegaría una función serverless al abrir la página.
 */
export async function GET() {
  return NextResponse.json(
    {
      key: PUSHER_KEY,
      cluster: PUSHER_CLUSTER,
      channel: PUSHER_CHANNEL,
      events: PUSHER_EVENTS,
      configurado: Boolean(PUSHER_KEY),
    },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
