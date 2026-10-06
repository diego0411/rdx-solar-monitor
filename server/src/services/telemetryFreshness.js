export const FRESH_MINUTES = 15;

export function telemetryFreshness(lastDataAt, now = Date.now()) {
  const timestamp = lastDataAt == null ? NaN : Date.parse(lastDataAt);
  if (!Number.isFinite(timestamp)) return { data_status: 'no_data', data_age_minutes: null };
  const age = (now - timestamp) / 60000;
  return {
    data_status: age >= 0 && age <= FRESH_MINUTES ? 'fresh' : 'stale',
    data_age_minutes: Number(Math.max(0, age).toFixed(2)),
  };
}

/*
 * Telemetría operativa de planta: solo inversores.
 *
 * - HYXi: STRING_INVERTER / HYBRID_INVERTER (misma lista canónica que
 *   usan dashboard y plants overview para contadores de inversores).
 * - Growatt: MIN (sus inversores llegan como dispositivos virtuales de
 *   descubrimiento; misma convención que plants overview).
 * - Excluidos siempre: COLLECTOR y meter (auxiliares: un colector o un
 *   medidor con dato reciente no debe mantener la planta "online" si el
 *   inversor principal no tiene telemetría operativa válida).
 */
export const OPERATIONAL_INVERTER_TYPES = ['STRING_INVERTER', 'HYBRID_INVERTER', 'MIN'];

export function isOperationalInverter(device) {
  return OPERATIONAL_INVERTER_TYPES.includes(String(device?.device_type ?? '').toUpperCase());
}

function operationalTelemetryTimestamp(row) {
  if (!row) return null;
  // Frescura operativa = momento real de medición del dispositivo.
  // updated_at solo refleja sincronización/escritura local (cada upsert
  // lo refresca) y nunca es evidencia de conectividad: collected_at
  // NULL o inválido => no fresh, sin fallback.
  return row.collected_at ?? null;
}

export function plantHasFreshOperationalTelemetry(devices, getLatestRow, now = Date.now()) {
  for (const device of devices ?? []) {
    if (!isOperationalInverter(device)) continue;
    const timestamp = operationalTelemetryTimestamp(getLatestRow?.(device.id));
    if (telemetryFreshness(timestamp, now).data_status === 'fresh') return true;
  }
  return false;
}

/*
 * Estado operativo de planta, derivado en lectura (no toca el
 * plants.status persistido del fabricante):
 *
 * - alarm: se conserva solo la alarma real reportada.
 * - online: reportada online Y con al menos un inversor fresh.
 *   0 W con telemetría reciente es válido (no se mira potencia).
 * - unknown: reportada unknown.
 * - offline: todo lo demás (incluye online-reportada pero stale:
 *   cubre la espera nocturna sin afirmar falla física).
 */
export function operationalPlantStatus(plant, devices, getLatestRow, now = Date.now()) {
  const reported = plant?.status;
  if (reported === 'alarm') return 'alarm';
  if (reported === 'unknown') return 'unknown';
  if (reported === 'online'
    && plantHasFreshOperationalTelemetry(devices, getLatestRow, now)) {
    return 'online';
  }
  return 'offline';
}
