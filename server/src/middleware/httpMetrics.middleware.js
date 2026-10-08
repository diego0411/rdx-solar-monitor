/*
 * Instrumentación ligera de rendimiento HTTP (opt-in).
 *
 * Mide la duración de cada request y emite UNA línea estructurada por
 * respuesta vía console.info, sin dependencias ni almacenamiento en BD.
 * No altera respuestas, autenticación ni permisos: solo observa.
 *
 * Privacidad: nunca registra headers (Authorization), query strings,
 * cuerpos ni parámetros. La ruta se publica como patrón Express
 * (p. ej. /api/plants/:plantId/overview); para rutas sin coincidencia
 * se redactan UUIDs y segmentos numéricos.
 *
 * Activación: HTTP_METRICS_ENABLED=true (desactivada por defecto).
 * Overhead cuando está desactivada: una comparación de string.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_PATTERN = /^\d+$/;

export function metricsEnabled() {
  return process.env.HTTP_METRICS_ENABLED === 'true';
}

// Patrón de ruta sin identificadores concretos. Con coincidencia de ruta
// se usa el patrón Express (baseUrl + route.path); sin coincidencia
// (404) se redacta el path crudo por segmento.
export function normalizeHttpRoute(req) {
  const routePath = req?.route?.path;
  if (typeof routePath === 'string') {
    return `${req.baseUrl ?? ''}${routePath}`;
  }
  const rawPath = typeof req?.path === 'string' ? req.path : '';
  return rawPath.split('/').map(segment => {
    if (UUID_PATTERN.test(segment) || NUMERIC_PATTERN.test(segment)) return ':id';
    return segment;
  }).join('/');
}

function responseBytes(res) {
  const value = res?.getHeader?.('content-length');
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

export function httpMetrics(req, res, next) {
  if (!metricsEnabled()) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const entry = {
      method: req.method,
      route: normalizeHttpRoute(req),
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 1000) / 1000,
    };
    const bytes = responseBytes(res);
    if (bytes !== undefined) entry.response_bytes = bytes;
    console.info('http_metric', entry);
  });
  return next();
}
