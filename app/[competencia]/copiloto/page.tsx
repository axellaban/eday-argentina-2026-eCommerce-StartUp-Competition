import { notFound } from "next/navigation";
import { COMPETENCIAS, getCompetencia } from "@/lib/competencias";
import Copiloto from "./Copiloto";

/**
 * Punto de entrada del copiloto: /{competencia}/copiloto
 *
 * Es un server component a propósito. La lista de equipos y los indicadores
 * salen del registro y llegan al cliente ya resueltos, sin pasar por una ruta
 * abierta: /api/config es público —lo consume el dashboard— y los equipos no
 * tienen por qué estar ahí.
 *
 * Un slug desconocido es 404 y no la competición por defecto: si alguien
 * escribe mal la URL en la sala, es mejor que lo vea antes de grabar un pitch
 * entero contra la base equivocada.
 */
export function generateStaticParams() {
  return COMPETENCIAS.map((c) => ({ competencia: c.slug }));
}

export function generateMetadata({ params }: { params: { competencia: string } }) {
  const comp = getCompetencia(params.competencia);
  return { title: comp ? `Copiloto · ${comp.nombre}` : "Copiloto" };
}

export default function CopilotoPage({ params }: { params: { competencia: string } }) {
  const comp = getCompetencia(params.competencia);
  if (!comp) notFound();
  return <Copiloto comp={comp} />;
}
