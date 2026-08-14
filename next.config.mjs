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
      ],
    };
  },
};

export default nextConfig;
