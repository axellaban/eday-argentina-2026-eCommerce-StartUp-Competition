import { NextResponse } from "next/server";
import { equiposDelSheet } from "@/lib/sheet";
import { competenciaOrDefault } from "@/lib/competencias";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Los equipos que presentan, leídos de la planilla DE SU COMPETICIÓN.
 *
 * El slug es obligatorio en la práctica: sin él se cae en la primera del
 * registro y el copiloto ofrecería los equipos de la otra competición.
 *
 * Va por el servidor y no directo desde el navegador del copiloto por dos
 * razones: no depende de que Google mande las cabeceras de CORS —que las manda,
 * pero es una dependencia más para el día del evento— y la respuesta se cachea
 * en el CDN, así que abrir el copiloto varias veces no son varias consultas.
 *
 * Treinta segundos de cache: el jurado no cambia los nombres en medio de un
 * pitch, y si hace falta forzar la relectura está el botón de recargar, que
 * agrega `?t=`.
 *
 * Devuelve también cuántos equipos se esperaban y si la cuenta da. No recorta
 * ni completa nada con ese número: la lista es la que trae la hoja. Sirve para
 * que el copiloto avise cuando la lectura salió corta, porque una lista con
 * catorce de dieciséis equipos se ve perfectamente normal hasta que falta uno
 * en el escenario.
 */
export async function GET(req: Request) {
  const comp = competenciaOrDefault(new URL(req.url).searchParams.get("competencia"));
  const { equipos, motivo } = await equiposDelSheet(comp);

  const esperados = comp.equiposEsperados ?? null;
  const coincide = esperados === null ? null : equipos.length === esperados;

  return NextResponse.json(
    { competencia: comp.slug, equipos, cuantos: equipos.length, esperados, coincide, motivo: motivo ?? null },
    {
      headers: {
        // Sólo se cachea la lectura buena. Un vacío, o una lista corta, se
        // vuelven a intentar en la próxima consulta en vez de quedar servidos
        // desde el CDN durante medio minuto.
        "Cache-Control": equipos.length && coincide !== false
          ? "public, max-age=0, s-maxage=30, stale-while-revalidate=120"
          : "no-store",
      },
    }
  );
}
