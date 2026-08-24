import { NextResponse } from "next/server";
import { PUSHER_CLUSTER, PUSHER_EVENTS, PUSHER_KEY, canalDe } from "@/lib/pusher-config";
import { COMPETENCIAS, competenciaOrDefault, layoutPlanilla } from "@/lib/competencias";

export const dynamic = "force-dynamic";

/**
 * Config pública de una competición, para el dashboard estático.
 *
 * `public/index.html` es HTML plano servido tal cual, sin bundler y sin build:
 * no hay forma de inyectarle constantes en tiempo de compilación. Antes eso se
 * resolvía clavando la planilla, los criterios y el canal adentro del propio
 * HTML — que es justamente lo que impedía tener más de una competición.
 * Ahora el HTML lee el slug de su URL y pide acá el resto.
 *
 * Reemplaza a /api/pusher-config, que devolvía sólo el canal.
 *
 * No expone nada secreto:
 *   - La key de Pusher es pública por diseño y sólo sirve para ESCUCHAR;
 *     publicar requiere PUSHER_SECRET, que nunca sale del servidor.
 *   - El sheetId ya viajaba dentro del HTML, y la planilla está compartida
 *     como "cualquiera con el enlace puede ver".
 *   - La lista de equipos NO se incluye: la pide el copiloto a /api/equipos,
 *     que está detrás de la contraseña. Quién presenta y con qué proyecto es
 *     información de backstage, no del público.
 *
 * Se cachea 5 minutos en el CDN: no cambia entre pitches, y sin cache cada
 * visitante del dashboard pegaría una función serverless al abrir la página.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const comp = competenciaOrDefault(searchParams.get("competencia"));

  return NextResponse.json(
    {
      competencia: {
        slug: comp.slug,
        nombre: comp.nombre,
        nombreCorto: comp.nombreCorto,
        evento: comp.evento,
        organizador: comp.organizador,
        acento: comp.acento,
        sheetId: comp.sheetId,
        sheetName: comp.sheetName,
        sheetGid: comp.sheetGid || null,
        indicadores: comp.indicadores,
        layout: layoutPlanilla(comp),
      },
      // Para el selector: permite saltar de una competición a la otra sin
      // volver a la home.
      competencias: COMPETENCIAS.map((c) => ({
        slug: c.slug,
        nombre: c.nombre,
        nombreCorto: c.nombreCorto,
        acento: c.acento,
      })),
      pusher: {
        key: PUSHER_KEY,
        cluster: PUSHER_CLUSTER,
        channel: canalDe(comp.slug),
        events: PUSHER_EVENTS,
        configurado: Boolean(PUSHER_KEY),
      },
    },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
  );
}
