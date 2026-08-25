import type { NextConfig } from 'next';

/**
 * Exportación estática: el sitio entero son ficheros HTML, JS y JSON que se
 * suben tal cual a Cloudflare Pages. Sin servidor, sin funciones, sin runtime
 * que mantener. Todo lo que necesitaba servidor vive ahora en el navegador
 * (imagen de compartir, sesión) o en un Worker aparte y opcional (precios).
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
