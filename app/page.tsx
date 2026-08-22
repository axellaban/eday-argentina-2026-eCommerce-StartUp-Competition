import { COMPETENCIAS } from "@/lib/competencias";

/**
 * La raíz del dominio: elegir competición. Nada más.
 *
 * No es la puerta por la que se entra durante el evento. En la sala, el
 * operador y la pantalla van SIEMPRE por el link directo a
 * /{competencia}/copiloto y /{competencia}/ai: nadie debería estar eligiendo
 * de una lista en una pantalla proyectada, y un click equivocado ahí manda a
 * la competición que no era.
 *
 * Esto es para el que llega después —el que vio el evento en LinkedIn, el
 * sponsor, alguien que se guardó el dominio pelado— y sólo necesita saber
 * cuál de las tres busca. Por eso no hay estadísticas ni bajadas: cada dato
 * extra acá es una decisión más antes de llegar a lo que vino a ver.
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
        <p className="home__sub">Elegí la competición</p>
      </header>

      <nav className="home__grid" aria-label="Competiciones">
        {COMPETENCIAS.map((c) => (
          <a
            key={c.slug}
            className="home__card"
            href={`/${c.slug}`}
            style={{ ["--acento" as string]: c.acento }}
          >
            <span className="home__card-nombre">{c.nombre}</span>
            {/* La flecha es la señal de que esto lleva a otro lado: una caja
                con un nombre adentro no se lee como algo clickeable. */}
            <span className="home__card-flecha" aria-hidden="true">→</span>
          </a>
        ))}
      </nav>

      <p className="home__pie">eCommerce Institute · eCommerce DAY Argentina 2026</p>
    </main>
  );
}
