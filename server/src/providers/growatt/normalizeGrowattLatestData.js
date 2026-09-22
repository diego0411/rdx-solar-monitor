import {
  parseGrowattTimestamp,
  isGrowattFault,
} from './growattStates.js';

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

function normalizeDeviceStatus(data) {
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

  return 'unknown';
}

export function normalizeGrowattLatestData(data, deviceId, plantTimezone) {
  return {
    device_id: deviceId,
    provider: 'growatt',

    collected_at: parseGrowattTimestamp(
      value(data, 'time'),
      plantTimezone,
    ),

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

    device_status: normalizeDeviceStatus(data),

    raw_data: data,
  };
}