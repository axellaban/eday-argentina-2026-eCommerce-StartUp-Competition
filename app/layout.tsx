import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Dominio del sitio para las vistas previas al compartir.
 *
 * Los scrapers de WhatsApp y compañía no ejecutan JS y necesitan URLs
 * absolutas, así que la imagen no puede ir con ruta relativa. En Vercel,
 * VERCEL_URL trae el dominio del deploy —incluidos los de preview—, y si no
 * está (desarrollo local) se cae al de producción.
 *
 * Si algún día el evento tiene dominio propio, se cambia acá y en el <head>
 * de public/index.html, que es HTML estático y no pasa por este archivo.
 */
const SITIO = process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
  || "https://eday-2026-argentina-ecommerce-startup-competition-demo-day.vercel.app";

const TITULO = "Demo Day · eCommerce StartUp Competition Argentina 2026";
const DESCRIPCION =
  "Evaluación en vivo con IA. Los 6 indicadores oficiales moviéndose en tiempo real mientras cada equipo presenta.";

export const metadata: Metadata = {
  metadataBase: new URL(SITIO),
  title: "Copiloto – eCommerce StartUp Competition | eCommerce DAY Argentina",
  description: DESCRIPCION,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    siteName: "eCommerce DAY Argentina",
    locale: "es_AR",
    title: TITULO,
    description: DESCRIPCION,
    url: SITIO,
    // Absoluta y no relativa: en desarrollo Next la resolvía contra
    // localhost, y así queda siempre apuntando al dominio real.
    images: [{ url: `${SITIO}/og-image.png`, width: 1200, height: 630, alt: TITULO }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITULO,
    description: DESCRIPCION,
    images: [`${SITIO}/og-image.png`],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#022840",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
