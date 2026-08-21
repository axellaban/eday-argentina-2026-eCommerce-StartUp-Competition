import { readFileSync } from "node:fs";

/**
 * Las rutas salen del mismo registro que usa la app.
 *
 * competencias.json es la fuente única: lo lee lib/competencias.ts para los
 * indicadores, la planilla y los equipos, y lo lee este archivo para las
 * rutas. Agregar una competición es agregar una entrada ahí y nada más — si
 * la lista viviera duplicada acá, tarde o temprano una competición nueva
 * funcionaría en el copiloto y daría 404 en el dashboard.
 *
 * Se lee con fs y no con import porque next.config corre antes de que exista
 * cualquier resolución de módulos de la app.
 */
const { competencias } = JSON.parse(
  readFileSync(new URL("./competencias.json", import.meta.url), "utf-8")
);
const SLUGS = competencias.map((c) => c.slug);
const SLUG_DEFAULT = SLUGS[0];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  async rewrites() {
    return {
      /**
       * beforeFiles corre ANTES del routing por filesystem.
       *
       * El dashboard es public/index.html: HTML plano, sin bundler. Cada
       * competición lo sirve en su propio path y el JS de adentro lee el slug
       * de location.pathname para pedir su config a /api/config.
       *
       * Se enumeran los paths exactos a propósito. Un comodín tipo
       * "/:competencia" se comería /api, /login y /_next, que es justamente lo
       * que rompía la home cuando el rewrite era demasiado ancho.
       *
       * Ojo: /{slug}/copiloto NO está acá. Esa es una página de Next de
       * verdad y tiene que llegarle al filesystem.
       */
      beforeFiles: SLUGS.flatMap((slug) => [
        { source: `/${slug}`, destination: "/index.html" },
        // La vista AI Judge es el mismo HTML abierto en otro modo: duplicar el
        // archivo sería duplicar el dashboard entero. El JS mira el pathname.
        { source: `/${slug}/ai`, destination: "/index.html" },
      ]),
    };
  },

  /**
   * Las URLs viejas, de cuando había una sola competición.
   *
   * Existieron impresas, compartidas por WhatsApp y guardadas como marcador.
   * Que caigan en la competición original en vez de dar 404 cuesta dos líneas.
   */
  async redirects() {
    return [
      { source: "/ai", destination: `/${SLUG_DEFAULT}/ai`, permanent: false },
      { source: "/copiloto", destination: `/${SLUG_DEFAULT}/copiloto`, permanent: false },
      // /publico se eliminó: la vista en vivo es AI Judge.
      { source: "/publico", destination: `/${SLUG_DEFAULT}/ai`, permanent: false },
    ];
  },
};

export default nextConfig;
