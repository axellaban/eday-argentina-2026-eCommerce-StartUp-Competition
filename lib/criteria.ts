/**
 * Los 6 indicadores oficiales de la competencia.
 *
 * Fuente única para el prompt del copiloto, la pantalla de setup y la pantalla
 * pública. El orden es el mismo que el de las columnas C-H de la hoja "Análisis"
 * del Google Sheet del jurado, y `key` es el que viaja en los eventos de Pusher.
 *
 * El dashboard estático (public/index.html) replica estos `label` en su propia
 * constante CRITERIA porque es HTML plano sin bundler: si cambiás algo acá,
 * cambialo también allá.
 *
 * Escalas: el jurado puntúa de 1 a 5 en el Sheet; el análisis en vivo de la IA
 * usa 0 a 100 (50 = neutro) porque es un medidor que se mueve durante el pitch.
 */

export interface Indicator {
  key: "mercado" | "producto" | "innovacion" | "ejecucion" | "equipo" | "percepcion";
  icon: string;
  label: string;
  short: string;
  description: string;
}

export const INDICATORS: Indicator[] = [
  {
    key: "mercado",
    icon: "🌍",
    label: "Potencial de Mercado",
    short: "Mercado",
    description: "Tamaño y alcance de la oportunidad: a cuántos les sirve y qué tan grande es el dolor.",
  },
  {
    key: "producto",
    icon: "🧲",
    label: "Producto y Adopción",
    short: "Producto",
    description: "Qué tan usable y adoptable es la solución: funciona de verdad y alguien la está usando.",
  },
  {
    key: "innovacion",
    icon: "🧱",
    label: "Innovación y Tecnología",
    short: "Innovación",
    description: "Calidad de la arquitectura agéntica: orquestación, conectores, prompts, memoria, human-in-the-loop.",
  },
  {
    key: "ejecucion",
    icon: "🏃",
    label: "Ejecución y Avance",
    short: "Ejecución",
    description: "Qué tan lejos llegaron: demo en vivo sin fallos, tiempo en producción, impacto medido.",
  },
  {
    key: "equipo",
    icon: "👥",
    label: "Perfil del Equipo y Visión",
    short: "Equipo",
    description: "Capacidad del equipo para llevarlo adelante y claridad de hacia dónde va.",
  },
  {
    key: "percepcion",
    icon: "👁️",
    label: "Percepción Personal",
    short: "Percepción",
    description: "Impresión general del pitch: claridad, convicción y ganas de robarle la idea.",
  },
];

export const INDICATOR_KEYS = INDICATORS.map((i) => i.key);

/** Bloque de texto listo para inyectar en un prompt. */
export const INDICATORS_PROMPT_BLOCK = INDICATORS.map(
  (i, n) => `   ${n + 1}. ${i.key} (${i.icon} ${i.label}): ${i.description}`
).join("\n");

/** Valores neutros de arranque (0-100, 50 = neutro). */
export function neutralMetrics(): Record<string, number> {
  return Object.fromEntries(INDICATORS.map((i) => [i.key, 50]));
}
