import { NextResponse } from "next/server";
import { equiposDelSheet } from "@/lib/sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Los equipos que presentan, leídos de la planilla del jurado.
 *
 * Va por el servidor y no directo desde el navegador del copiloto por dos
 * razones: no depende de que Google mande las cabeceras de CORS —que las manda,
 * pero es una dependencia más para el día del evento— y la respuesta se cachea
 * en el CDN, así que abrir el copiloto varias veces no son varias consultas.
 *
 * Treinta segundos de cache: el jurado no cambia los nombres en medio de un
 * pitch, y si hace falta forzar la relectura está el botón de recargar, que
 * agrega `?t=`.
 */
export async function GET() {
  const equipos = await equiposDelSheet();

  return NextResponse.json(
    { equipos, cuantos: equipos.length },
    {
      headers: {
        "Cache-Control": equipos.length
          ? "public, max-age=0, s-maxage=30, stale-while-revalidate=120"
          // Si la hoja no contestó, no se cachea el vacío: la próxima consulta
          // vuelve a intentar en vez de servir "no hay equipos" durante medio
          // minuto.
          : "no-store",
      },
    }
  );
}
