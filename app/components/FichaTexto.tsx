"use client";

import React from "react";

/**
 * Dibuja la ficha de evaluación que genera el LLM.
 *
 * La ficha viene con marcado tipo markdown (`**TÍTULO**`, viñetas con `•`,
 * `**Nombre:**` en negrita). Antes se mostraba como texto plano, así que en
 * pantalla se leían los asteriscos crudos. El dashboard estático ya la
 * parseaba; esto hace lo mismo para el copiloto y la pantalla pública.
 */

const COLOR_SECCION: Record<string, string> = {
  "RESUMEN DEL PROYECTO": "var(--brand)",
  FORTALEZAS: "var(--green)",
  "ÁREAS DE MEJORA": "var(--gold)",
  VEREDICTO: "var(--brand)",
};

/** Convierte `**algo**` en negrita, dejando el resto como texto. */
function conNegritas(texto: string, keyBase: string): React.ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) => {
    if (parte.startsWith("**") && parte.endsWith("**")) {
      return (
        <strong key={`${keyBase}-${i}`} style={{ color: "var(--text)" }}>
          {parte.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={`${keyBase}-${i}`}>{parte}</React.Fragment>;
  });
}

interface Seccion {
  titulo: string | null;
  lineas: string[];
}

export function parsearFicha(texto: string): Seccion[] {
  const secciones: Seccion[] = [];
  let actual: Seccion = { titulo: null, lineas: [] };

  texto.split("\n").forEach((linea) => {
    const encabezado = linea.trim().match(/^\*\*([A-ZÁÉÍÓÚÑ\s]+)\*\*$/);
    if (encabezado) {
      if (actual.titulo || actual.lineas.some((l) => l.trim())) secciones.push(actual);
      actual = { titulo: encabezado[1].trim(), lineas: [] };
    } else {
      actual.lineas.push(linea);
    }
  });
  if (actual.titulo || actual.lineas.some((l) => l.trim())) secciones.push(actual);
  return secciones;
}

export default function FichaTexto({ raw }: { raw: string }) {
  const secciones = parsearFicha(raw || "");

  // Si no trae el formato esperado, se muestra tal cual: mejor eso que nada.
  if (secciones.length === 0 || secciones.every((s) => !s.titulo)) {
    return <div className="ficha-texto__plano">{raw}</div>;
  }

  return (
    <div className="ficha-texto">
      {secciones.map((sec, si) => {
        const color = sec.titulo ? COLOR_SECCION[sec.titulo] || "var(--brand)" : "var(--brand)";
        const esVeredicto = sec.titulo === "VEREDICTO";
        const lineas = sec.lineas.filter((l) => l.trim());
        if (!sec.titulo && lineas.length === 0) return null;

        return (
          <section
            key={si}
            className={`ficha-sec${esVeredicto ? " ficha-sec--veredicto" : ""}`}
            style={esVeredicto ? ({ "--sec": color } as React.CSSProperties) : undefined}
          >
            {sec.titulo && (
              <h4 className="ficha-sec__titulo" style={{ color }}>
                <span className="ficha-sec__punto" style={{ background: color }} />
                {sec.titulo}
              </h4>
            )}

            {lineas.map((linea, li) => {
              const vinieta = linea.trim().match(/^[•\-*]\s+(.*)$/);
              if (vinieta) {
                return (
                  <p className="ficha-sec__item" key={li}>
                    <span className="ficha-sec__bullet" style={{ color }}>
                      ▸
                    </span>
                    <span>{conNegritas(vinieta[1], `${si}-${li}`)}</span>
                  </p>
                );
              }
              return (
                <p className="ficha-sec__parrafo" key={li}>
                  {conNegritas(linea, `${si}-${li}`)}
                </p>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
