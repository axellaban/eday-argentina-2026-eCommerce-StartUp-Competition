/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      // beforeFiles corre ANTES del routing por filesystem. Con `afterFiles`
      // (el array plano) cualquier ruta real de la app le gana a este rewrite,
      // que fue justamente lo que dejaba "/" en blanco.
      beforeFiles: [
        {
          source: "/",
          destination: "/index.html",
        },
        /**
         * /ai es el mismo dashboard, arrancado en la vista AI Judge.
         *
         * No es una página aparte: duplicar el HTML sería duplicar todo el
         * dashboard. Es la misma, y el JS mira el pathname para saber en qué
         * modo abrir. Sirve para poder mandar a la sala directo a la vista de
         * la IA, y para que la elección quede en la URL en vez de en el
         * navegador de cada uno.
         */
        {
          source: "/ai",
          destination: "/index.html",
        },
      ],
    };
  },
};

export default nextConfig;
