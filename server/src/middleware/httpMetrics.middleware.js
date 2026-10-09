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
 *
 * Sub-mediciones: requireAuth guarda res.locals.auth_ms y loadProfile
 * res.locals.profile_ms (reloj monotónico, también en error). El
 * controlador de energy-history guarda energy_read_ms (lectura inicial),
 * energy_sync_ms (sync-on-read con el fabricante), energy_reread_ms
 * (relectura posterior), energy_range_ms (rango semanal adicional),
 * energy_aggregate_ms (agregación/transformación final) y la bandera
 * energy_sync_occurred (solo cuando hubo sincronización). Este
 * middleware las incorpora al log cuando están disponibles; las etapas
 * no ejecutadas se omiten, sin valores ficticios.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_PATTERN = /^\d+$/;
const SUB_MEASUREMENTS = [
  'auth_ms',
  'profile_ms',
  'energy_read_ms',
  'energy_sync_ms',
  'energy_reread_ms',
  'energy_range_ms',
  'energy_aggregate_ms',
];

export function metricsEnabled() {
  return process.env.HTTP_METRICS_ENABLED === 'true';
}

// Milisegundos con 3 decimales desde un process.hrtime.bigint().
export function elapsedMs(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1000) / 1000;
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
    const entry = {
      method: req.method,
      route: normalizeHttpRoute(req),
      status: res.statusCode,
      duration_ms: elapsedMs(start),
    };
    for (const key of SUB_MEASUREMENTS) {
      const value = res.locals?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        entry[key] = value;
      }
    }
    // Bandera de sync-on-read (energy-history): solo presente cuando el
    // controlador ejecutó una sincronización con el fabricante. Sin IDs,
    // URLs ni payloads: únicamente el hecho de que ocurrió.
    if (res.locals?.energy_sync_occurred === true) {
      entry.energy_sync_occurred = true;
    }
    const bytes = responseBytes(res);
    if (bytes !== undefined) entry.response_bytes = bytes;
    console.info('http_metric', entry);
  });
  return next();
}
