/*
 * Normalización de zonas horarias para intervalos almacenados.
 *
 * Acepta nombres IANA válidos (America/La_Paz, Etc/GMT+4, UTC, ...)
 * y offsets Growatt con formato GMT±H[:MM] (GMT-4, GMT+4, GMT-04:00).
 *
 * Los offsets GMT usan convención Growatt (muro = UTC ± X),
 * NO la inversión de signos POSIX de Etc/GMT. Las zonas Etc/GMT*
 * se resuelven vía Intl, que ya aplica POSIX correctamente.
 *
 * Nunca lanza: zona inválida o desconocida → UTC.
 */

const GMT_PATTERN = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i;

const formatters = new Map();

function cachedFormatter(timeZone) {
  let formatter = formatters.get(timeZone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // Valida la zona inmediatamente: lanza RangeError si no existe.
    formatter.format(0);
    formatters.set(timeZone, formatter);
  }

  return formatter;
}

function gmtOffsetMs(value) {
  const match = GMT_PATTERN.exec(value);

  if (!match) return null;

  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');

  if (hours > 14 || minutes > 59) return null;

  const sign = match[1] === '-' ? -1 : 1;

  return sign * (hours * 60 + minutes) * 60 * 1000;
}

function utcDateKey(wallMs) {
  const date = new Date(wallMs);

  return `${
    String(date.getUTCFullYear()).padStart(4, '0')
  }-${
    String(date.getUTCMonth() + 1).padStart(2, '0')
  }-${
    String(date.getUTCDate()).padStart(2, '0')
  }`;
}

/*
 * Fecha calendario local 'YYYY-MM-DD' de un instante.
 * Devuelve null solo si el instante es inválido.
 */
export function localDateKey(instant, timezone) {
  const ms = instant instanceof Date
    ? instant.getTime()
    : Date.parse(instant);

  if (!Number.isFinite(ms)) return null;

  const zone = String(timezone ?? 'UTC').trim() || 'UTC';

  try {
    const parts = Object.fromEntries(
      cachedFormatter(zone)
        .formatToParts(new Date(ms))
        .map(part => [part.type, part.value]),
    );

    return `${
      parts.year.padStart(4, '0')
    }-${parts.month}-${parts.day}`;
  } catch {
    const offset = gmtOffsetMs(zone);

    if (offset === null) return utcDateKey(ms);

    return utcDateKey(ms + offset);
  }
}
