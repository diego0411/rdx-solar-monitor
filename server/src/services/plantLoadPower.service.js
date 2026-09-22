export const HYXI_LOAD_POWER_MAX_AGE_MINUTES = 60;

const HYXI_LOAD_POWER_MAX_AGE_MS =
  HYXI_LOAD_POWER_MAX_AGE_MINUTES * 60 * 1000;

/**
 * Resuelve realtime.load_power de planta:
 * 1. Prioriza el load_power agregado desde dispositivos.
 * 2. Si no existe y provider=hyxi, acepta el último consumption_power_w
 *    de queryPlantPowerStatistics (persistido) si su timePoint real
 *    tiene 60 minutos o menos de antigüedad.
 * 3. Si ninguno existe, o el punto supera los 60 minutos, load_power
 *    queda null. El valor 0 se acepta como válido.
 * El fallback no modifica data_status ni data_age_minutes: la frescura
 * global de telemetría la sigue gobernando FRESH_MINUTES en exclusiva.
 */
export function resolvePlantLoadPower({
  deviceLoadPower = null,
  latestConsumption = null,
  provider = null,
  now = Date.now(),
} = {}) {
  if (deviceLoadPower != null) {
    return { load_power: deviceLoadPower, load_power_at: null };
  }

  if (provider !== 'hyxi') {
    return { load_power: null, load_power_at: null };
  }

  const point = latestConsumption ?? null;
  const value = point?.consumption_power_w;

  if (value == null || typeof point.interval_start !== 'string') {
    return { load_power: null, load_power_at: null };
  }

  const timestamp = Date.parse(point.interval_start);
  const age = now - timestamp;

  if (!Number.isFinite(timestamp) || !Number.isFinite(age)
      || age < 0 || age > HYXI_LOAD_POWER_MAX_AGE_MS) {
    return { load_power: null, load_power_at: null };
  }

  return { load_power: value, load_power_at: point.interval_start };
}