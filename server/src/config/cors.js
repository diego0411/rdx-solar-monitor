/*
 * CORS con allowlist configurable.
 *
 * - Producción: solo los orígenes exactos de CORS_ORIGINS
 *   (lista separada por comas). Sin wildcard y sin credentials
 *   (la API usa Bearer token, no cookies).
 * - Requests sin Origin (server-to-server, health checks,
 *   herramientas internas) siempre se permiten.
 * - Desarrollo: además se permiten orígenes http://localhost y
 *   http://127.0.0.1 (cualquier puerto) para el portal local
 *   (Vite :5173 -> API :3000).
 */

export function parseAllowedOrigins(raw) {
  return String(raw ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
}

export function isOriginAllowed(origin, options = {}) {
  // Sin Origin: server-to-server, curl, health checks.
  if (!origin) return true;

  const allowed = parseAllowedOrigins(options.allowedOrigins ?? process.env.CORS_ORIGINS);
  if (allowed.includes(origin)) return true;

  if ((options.nodeEnv ?? process.env.NODE_ENV) !== 'production') {
    try {
      const url = new URL(origin);
      if (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

export const corsOptions = {
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin));
  },
};
