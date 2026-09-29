/*
 * Normalización determinista de timezone para los gráficos.
 *
 * Contrato: la API entrega timezone de planta como 'GMT-4' (Growatt/HYXi)
 * o un identificador IANA. 'GMT-4' NO es IANA válido y lanza RangeError
 * en Intl.DateTimeFormat, por eso se resuelve explícitamente a
 * America/La_Paz. Los identificadores IANA válidos se conservan.
 * Cualquier otro valor cae al fallback del proyecto, nunca a la zona
 * del navegador (no determinista).
 *
 * Solo resuelve el identificador; jamás toca los timestamps (siguen
 * siendo UTC interpretados por Date/Intl).
 */
const PROJECT_TIME_ZONE = 'America/La_Paz';
const LA_PAZ_GMT_PATTERN = /^GMT-0?4(?::00)?$/i;

export function resolveChartTimeZone(timezone) {
  const value = typeof timezone === 'string' ? timezone.trim() : '';
  if (LA_PAZ_GMT_PATTERN.test(value)) return PROJECT_TIME_ZONE;
  if (value) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return value;
    } catch {
      // Identificador inválido: fallback determinista abajo.
    }
  }
  return PROJECT_TIME_ZONE;
}
