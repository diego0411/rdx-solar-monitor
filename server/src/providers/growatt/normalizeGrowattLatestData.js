function value(data, ...keys) {
  for (const key of keys) {
    if (data?.[key] !== undefined && data[key] !== null) return data[key];
  }
  return null;
}

function numeric(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const localTime = `${match[1]}T${match[2]}`;
  const validation = new Date(`${localTime}Z`);
  if (!Number.isFinite(validation.getTime())
      || validation.toISOString().slice(0, 19) !== localTime) return null;
  const date = new Date(`${localTime}-04:00`);
  return date.getTime() <= Date.now() + 10 * 60 * 1000 ? date.toISOString() : null;
}

export function normalizeGrowattLatestData(data, deviceId) {
  return {
    device_id: deviceId,
    provider: 'growatt',
    collected_at: timestamp(value(data, 'time')),
    pv_power: value(data, 'ppv'),
    ac_power: value(data, 'pac'),
    today_energy: value(data, 'eacToday'),
    total_energy: value(data, 'eacTotal'),
    load_power: numeric(value(data, 'pacToLocalLoad')),
    grid_import_power: numeric(value(data, 'pacToUserTotal')),
    grid_export_power: numeric(value(data, 'pacToGridTotal')),
    battery_charge_power: value(data, 'chargePowerOfBattery'),
    battery_discharge_power: value(data, 'disChargePowerOfBattery'),
    device_status: Number(value(data, 'status')) === 1 ? 'online' : 'unknown',
    raw_data: data,
  };
}
