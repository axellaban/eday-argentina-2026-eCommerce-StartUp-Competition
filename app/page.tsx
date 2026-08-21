import { COMPETENCIAS } from "@/lib/competencias";

/**
 * La raíz del dominio: las competiciones que hay.
 *
 * No es la puerta por la que se entra durante el evento. En la sala, el
 * operador y la pantalla van SIEMPRE por el link directo a
 * /{competencia}/copiloto y /{competencia}/ai: nadie debería estar eligiendo
 * de una lista en una pantalla proyectada, y un click equivocado ahí manda a
 * la competición que no era.
 *
 * Esta página es para el que llega después —el que vio el evento en LinkedIn,
 * el sponsor, alguien que se guardó el dominio pelado— y no sabe cuál de las
 * dos busca.
 *
 * Antes acá había un rewrite al dashboard estático. Ahora ese dashboard vive
 * en /{competencia} y esto es una página de verdad.
 */
export const metadata = {
  title: "Demo Day · eCommerce DAY Argentina 2026",
};

export default function Home() {
  return (
    <main className="home">
      <header className="home__head">
        <img
          className="home__logo"
          src="/logos argentina/PNG/SIN BAJADA/02.png"
          alt="eCommerce DAY Argentina"
        />
        <h1 className="home__title">Demo Day 2026</h1>
        <p className="home__sub">
          Evaluación en vivo con IA. Elegí la competición para ver su dashboard.
        </p>
      </header>

      <div className="home__grid">
        {COMPETENCIAS.map((c) => (
          <a
            key={c.slug}
            className="home__card"
            href={`/${c.slug}`}
            style={{ ["--acento" as string]: c.acento }}
          >
            <span className="home__card-eyebrow">{c.evento}</span>
            <span className="home__card-title">{c.nombre}</span>
            <span className="home__card-meta">
              {c.indicadores.length} indicadores
              {c.equipos.length > 0 && ` · ${c.equipos.length} equipos`}
            </span>
            <span className="home__card-links">
              Dashboard
              <span className="home__card-sep">·</span>
              <span className="home__card-ai">AI Judge en {`/${c.slug}/ai`}</span>
            </span>
          </a>
        ))}
      </div>

      <footer className="home__foot">
        eCommerce Institute · Los dashboards se alimentan del puntaje del jurado
        y del análisis en vivo de cada pitch.
      </footer>
    </main>
  );
}
