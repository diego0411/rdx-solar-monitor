/*
 * Descriptor estructural de respuestas históricas HYXi para diagnóstico.
 *
 * Solo describe FORMA (presencia y tipos de `data`/`timePoint`), nunca
 * valores: no incluye payloads, credenciales ni datos energéticos.
 * Se adjunta como `error.historyShape` cuando la normalización o la
 * validación del envelope rechazan una respuesta, para distinguir
 * "sin datos" (data/timePoint ausentes) de "malformado".
 */

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

export function describeHyxiHistoryShape(response) {
  const data = response?.data;
  const timePoint = data !== null && typeof data === 'object' ? data.timePoint : undefined;
  const descriptor = {
    has_data: data !== null && data !== undefined,
    data_type: typeOf(data),
    has_time_point: timePoint !== null && timePoint !== undefined,
    time_point_type: timePoint === undefined ? 'undefined' : typeOf(timePoint),
  };
  if (Array.isArray(timePoint)) descriptor.time_point_length = timePoint.length;
  return descriptor;
}

// Adjunta el descriptor a un error de respuesta inválida y lo devuelve
// para relanzar. No pisa un descriptor ya presente ni toca el mensaje:
// la clasificación de válido/inválido queda intacta.
export function withHistoryShape(error, response) {
  if (error && typeof error === 'object' && error.historyShape === undefined) {
    error.historyShape = describeHyxiHistoryShape(response);
  }
  return error;
}
