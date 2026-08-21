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
 * cuál de las dos busca. Por eso son dos botones y no dos fichas: cualquier
 * dato extra acá es una decisión más que tomar antes de llegar a lo que vino
 * a ver.
 *
 * Antes esta ruta era un rewrite al dashboard, así que el dominio pelado caía
 * en una competición sin avisar que había otra.
 */
export const metadata = {
  title: "Demo Day · eCommerce DAY Argentina 2026",
};

export default function Home() {
  return (
    <main className="home">
      <img
        className="home__logo"
        src="/logos argentina/PNG/SIN BAJADA/02.png"
        alt="eCommerce DAY Argentina"
      />
      <h1 className="home__title">Demo Day 2026</h1>
      <p className="home__sub">Elegí la competición</p>

      <nav className="home__botones">
        {COMPETENCIAS.map((c) => (
          <a
            key={c.slug}
            className="home__boton"
            href={`/${c.slug}`}
            style={{ ["--acento" as string]: c.acento }}
          >
            {c.nombre}
          </a>
        ))}
      </nav>
    </main>
  );
}
