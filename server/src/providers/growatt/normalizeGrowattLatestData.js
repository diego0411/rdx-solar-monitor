import {
  parseGrowattTimestamp,
  isGrowattFault,
} from './growattStates.js';
import { FRESH_MINUTES } from '../../services/telemetryFreshness.js';

function value(data, ...keys) {
  for (const key of keys) {
    if (data?.[key] !== undefined && data[key] !== null) {
      return data[key];
    }
  }

  return null;
}

function numeric(value) {
  if (
    !['number', 'string'].includes(typeof value) ||
    String(value).trim() === ''
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDeviceStatus(data, plantTimezone, collectedAt, now) {
  /*
   * Growatt puede devolver simultáneamente:
   *
   * lost = true
   * status = 1
   * statusText = "Normal"
   *
   * "lost" no es fiable como señal de desconexión, por lo que no se usa
   * como fuente de estado. Una incidencia confirmada (status 3/fault o
   * códigos activos) tiene prioridad. Si además confluye un "lost",
   * el estado pasa a unknown porque las señales son contradictorias.
   */

  if (isGrowattFault(data)) {
    return 'alarm';
  }

  const status = numeric(value(data, 'status'));
  const lost = value(data, 'lost');
  const lostFlag = lost === true || String(lost).toLowerCase() === 'true';

  if (status === 1 && !lostFlag) {
    return 'online';
  }

  /*
   * Espera nocturna normal (inversor on-grid hibernando): sin
   * incidencia, con status 0/1 y telemetría no fresca durante la
   * noche local de la planta. Nunca enmascara fallos, datos
   * frescos contradictorios ni horarios diurnos: esos siguen
   * siendo unknown.
   */
  if (
    (status === 0 || status === 1)
    && isNightHour(plantTimezone, collectedAt, now)
  ) {
    return 'standby';
  }

  return 'unknown';
}

/*
 * Noche local 19:00–05:59 para la timezone de la planta.
 * Acepta IANA válido y offsets Growatt GMT±H[:MM] (muro = UTC ± X,
 * convención Growatt, no POSIX invertido).
 * Zona inválida o sin hora determinable: false (conservador).
 */
function isNightHour(plantTimezone, collectedAt, now) {
  const collectedMs = Date.parse(collectedAt);

  if (!Number.isFinite(collectedMs)) return false;
  if (now - collectedMs <= FRESH_MINUTES * 60 * 1000) return false;

  const zone = String(plantTimezone ?? '').trim() || 'UTC';
  let hour = gmtNightHour(zone, now);

  if (hour === null) {
    try {
      hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          hour: '2-digit',
          hour12: false,
        }).format(new Date(now)),
      );
    } catch {
      return false;
    }
  }

  if (!Number.isFinite(hour)) return false;
  if (hour === 24) hour = 0;

  return hour >= 19 || hour < 6;
}

function gmtNightHour(zone, now) {
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i.exec(zone);

  if (!match) return null;

  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');

  if (hours > 14 || minutes > 59) return null;

  const wallMs = now + (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes) * 60 * 1000;
  const wallHour = new Date(wallMs).getUTCHours();

  return wallHour === 24 ? 0 : wallHour;
}

export function normalizeGrowattLatestData(data, deviceId, plantTimezone, now = Date.now()) {
  const collectedAt = parseGrowattTimestamp(
    value(data, 'time'),
    plantTimezone,
  );

  return {
    device_id: deviceId,
    provider: 'growatt',

    collected_at: collectedAt,

    pv_power: value(
      data,
      'ppv'
    ),

    ac_power: value(
      data,
      'pac'
    ),

    today_energy: value(
      data,
      'eacToday'
    ),

    total_energy: value(
      data,
      'eacTotal'
    ),

    load_power: numeric(
      value(data, 'pacToLocalLoad')
    ),

    grid_import_power: numeric(
      value(data, 'pacToUserTotal')
    ),

    grid_export_power: numeric(
      value(data, 'pacToGridTotal')
    ),

    battery_charge_power: value(
      data,
      'chargePowerOfBattery'
    ),

    battery_discharge_power: value(
      data,
      'disChargePowerOfBattery'
    ),

    device_status: normalizeDeviceStatus(data, plantTimezone, collectedAt, now),

    raw_data: data,
  };
}