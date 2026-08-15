"use client";

import React, { useId } from "react";
import { INDICATORS } from "@/lib/criteria";

/**
 * Radar de los 6 indicadores para la pantalla de sala.
 *
 * Forma: una sola serie es el punto (el equipo que presenta ahora) y el resto
 * es contexto, así que va emphasis — un hue para "ahora" y gris para la
 * silueta de hace un minuto. La silueta además va punteada: la identidad
 * nunca queda sólo en el color.
 *
 * El polígono se dibuja con los valores YA interpolados que le pasa la página,
 * así que se deforma cuadro por cuadro mientras la persona habla en vez de
 * saltar de una lectura a la otra.
 */

/* El viewBox es más ancho que alto a propósito: las etiquetas de los vértices
   laterales se dibujan fuera del radio y necesitan lugar. Con un lienzo
   cuadrado el texto se salía y se montaba sobre la columna de al lado. */
const R = 150;          // radio del área de datos
const CX = 280;
const CY = 200;
const ANILLOS = [20, 40, 60, 80, 100];

/** Ángulo del eje i, arrancando arriba y girando en sentido horario. */
function angulo(i: number, total: number): number {
  return (Math.PI * 2 * i) / total - Math.PI / 2;
}

function punto(valor: number, i: number, total: number) {
  const a = angulo(i, total);
  const r = (Math.max(0, Math.min(100, valor)) / 100) * R;
  return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
}

function poligono(valores: number[]): string {
  return valores
    .map((v, i) => {
      const p = punto(v, i, valores.length);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(" ");
}

interface Props {
  /** Valores actuales, ya interpolados (0-100). */
  valores: Record<string, number>;
  /** Silueta de referencia, típicamente la lectura de hace ~1 minuto. */
  silueta?: Record<string, number> | null;
  /** Etiqueta de la silueta para la leyenda. */
  siluetaLabel?: string;
}

export default function Radar({ valores, silueta, siluetaLabel = "Hace ~1 min" }: Props) {
  const serie = INDICATORS.map((i) => valores[i.key] ?? 50);
  const serieSilueta = silueta ? INDICATORS.map((i) => silueta[i.key] ?? 50) : null;

  // En la pantalla pública hay varios radares a la vez (el del pitch en curso
  // y uno por equipo terminado). Con un id fijo, todos los <defs> compartían
  // nombre: HTML inválido y el primer gradiente pisando a los demás.
  const fillId = `radarFill-${useId().replace(/:/g, "")}`;

  return (
    <figure className="radar">
      <svg viewBox="0 0 560 420" className="radar__svg" role="img"
           aria-label="Radar de los 6 indicadores del equipo que presenta">
        <defs>
          <radialGradient id={fillId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.12" />
          </radialGradient>
        </defs>

        {/* Anillos de referencia: recesivos, nunca compiten con los datos */}
        {ANILLOS.map((v) => (
          <polygon
            key={v}
            points={poligono(INDICATORS.map(() => v))}
            className={`radar__anillo${v === 100 ? " radar__anillo--borde" : ""}`}
          />
        ))}

        {/* El 50 es el neutro: se marca porque significa algo */}
        <polygon points={poligono(INDICATORS.map(() => 50))} className="radar__neutro" />

        {/* Ejes */}
        {INDICATORS.map((ind, i) => {
          const p = punto(100, i, INDICATORS.length);
          return <line key={ind.key} x1={CX} y1={CY} x2={p.x} y2={p.y} className="radar__eje" />;
        })}

        {/* Silueta de referencia */}
        {serieSilueta && (
          <polygon points={poligono(serieSilueta)} className="radar__silueta" />
        )}

        {/* Estado actual */}
        <polygon points={poligono(serie)} className="radar__area" style={{ fill: `url(#${fillId})` }} />
        {serie.map((v, i) => {
          const p = punto(v, i, serie.length);
          return <circle key={INDICATORS[i].key} cx={p.x} cy={p.y} r="5" className="radar__punto" />;
        })}

        {/* Etiquetas de cada vértice */}
        {INDICATORS.map((ind, i) => {
          const a = angulo(i, INDICATORS.length);
          const p = { x: CX + Math.cos(a) * (R + 36), y: CY + Math.sin(a) * (R + 32) };
          const cos = Math.cos(a);
          const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
          const valor = Math.round(serie[i]);
          return (
            <g key={ind.key}>
              <text x={p.x} y={p.y - 6} textAnchor={anchor} className="radar__label">
                {ind.icon} {ind.short}
              </text>
              <text x={p.x} y={p.y + 14} textAnchor={anchor} className="radar__valor">
                {valor}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Leyenda sólo cuando hay dos formas. Con una sola serie sobra: el
          título de la sección ya dice qué es, y un cartel que dice "Ahora"
          bajo la huella de un equipo que ya terminó era directamente falso. */}
      {serieSilueta && (
        <figcaption className="radar__leyenda">
          <span className="radar__leyenda-item">
            <svg width="22" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="21" y2="4" className="radar__muestra radar__muestra--ahora" />
            </svg>
            Ahora
          </span>
          <span className="radar__leyenda-item radar__leyenda-item--mute">
            <svg width="22" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="21" y2="4" className="radar__muestra radar__muestra--antes" />
            </svg>
            {siluetaLabel}
          </span>
        </figcaption>
      )}
    </figure>
  );
}
