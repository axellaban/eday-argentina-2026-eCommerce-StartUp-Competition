"use client";

import React from "react";

/**
 * Transcript con las marcas del jurado.
 *
 * El modelo devuelve citas textuales, no posiciones: acá se buscan en el texto
 * y se envuelven. Si una cita no aparece literal (el modelo la parafraseó o el
 * texto cambió desde que se pidió el marcado), simplemente no se pinta. Nunca
 * se altera ni una letra del transcript.
 */

export type TipoMarca = "dato" | "demo" | "flojo";
export interface Marca {
  cita: string;
  tipo: TipoMarca;
}

export const TIPOS_MARCA: Record<TipoMarca, { label: string; icono: string; color: string }> = {
  dato: { label: "Evidencia dura", icono: "◆", color: "#199e70" },
  demo: { label: "Demo en vivo", icono: "▶", color: "#3987e5" },
  flojo: { label: "Sin respaldo", icono: "▲", color: "#d95926" },
};

interface Segmento {
  texto: string;
  tipo?: TipoMarca;
}

/** Parte el texto en segmentos, marcando los tramos citados sin solaparlos. */
export function segmentar(texto: string, marcas: Marca[]): Segmento[] {
  const rangos: { desde: number; hasta: number; tipo: TipoMarca }[] = [];

  marcas.forEach((m) => {
    const i = texto.indexOf(m.cita);
    if (i === -1) return;
    const desde = i;
    const hasta = i + m.cita.length;
    // Descartar solapes: gana la marca que llegó primero.
    if (rangos.some((r) => desde < r.hasta && hasta > r.desde)) return;
    rangos.push({ desde, hasta, tipo: m.tipo });
  });

  rangos.sort((a, b) => a.desde - b.desde);

  const segmentos: Segmento[] = [];
  let cursor = 0;
  rangos.forEach((r) => {
    if (r.desde > cursor) segmentos.push({ texto: texto.slice(cursor, r.desde) });
    segmentos.push({ texto: texto.slice(r.desde, r.hasta), tipo: r.tipo });
    cursor = r.hasta;
  });
  if (cursor < texto.length) segmentos.push({ texto: texto.slice(cursor) });

  return segmentos;
}

export function LeyendaMarcas({ conteo }: { conteo: Record<TipoMarca, number> }) {
  return (
    <div className="hl-legend">
      {(Object.keys(TIPOS_MARCA) as TipoMarca[]).map((tipo) => (
        <span className="hl-legend__item" key={tipo}>
          <span className="hl-legend__swatch" style={{ background: TIPOS_MARCA[tipo].color }} />
          {TIPOS_MARCA[tipo].icono} {TIPOS_MARCA[tipo].label}
          {conteo[tipo] > 0 && <strong style={{ color: "var(--text)" }}>{conteo[tipo]}</strong>}
        </span>
      ))}
    </div>
  );
}

export default function TranscriptMarcado({
  texto,
  interim,
  marcas,
}: {
  texto: string;
  interim?: string;
  marcas: Marca[];
}) {
  const segmentos = React.useMemo(() => segmentar(texto, marcas), [texto, marcas]);

  return (
    <>
      <p style={{ marginBottom: 8 }}>
        {segmentos.map((s, i) =>
          s.tipo ? (
            <mark
              key={i}
              className={`hl hl--${s.tipo}`}
              title={TIPOS_MARCA[s.tipo].label}
              style={{ color: "inherit" }}
            >
              {s.texto}
            </mark>
          ) : (
            <React.Fragment key={i}>{s.texto}</React.Fragment>
          )
        )}
      </p>
      {interim && <p className="transcript__interim">{interim}…</p>}
    </>
  );
}
