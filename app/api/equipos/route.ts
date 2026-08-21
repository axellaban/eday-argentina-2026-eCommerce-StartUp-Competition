import { NextResponse } from "next/server";
import { competenciaOrDefault } from "@/lib/competencias";
import { leerEquipos } from "@/lib/planilla";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Los equipos de una competición, leídos de su planilla.
 *
 * Lo consume el selector del copiloto. Así, agregar un equipo el día del
 * evento es agregar una fila en el Sheet y tocar "Actualizar": no hace falta
 * deployar.
 *
 * Va bajo /api/ y por lo tanto detrás de la contraseña del operador: la lista
 * de quién presenta y con qué proyecto es información del backstage, no del
 * público. Por eso tampoco viaja en /api/config, que sí es abierto.
 *
 * Nunca falla: si Google no responde devuelve la lista del registro con el
 * motivo adentro, para que el operador vea de dónde salió lo que está
 * mirando en vez de suponerlo.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const comp = competenciaOrDefault(searchParams.get("competencia"));
  const r = await leerEquipos(comp);

  return NextResponse.json({
    competencia: comp.slug,
    equipos: r.equipos,
    fuente: r.fuente,
    error: r.error || null,
  });
}
