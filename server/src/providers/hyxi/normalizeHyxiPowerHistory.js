const fields = {
  consumePower: 'consumption_power_w',
  yieldPower: 'generation_power_w',
  chargedPower: 'battery_charge_power_w',
  dischargedPower: 'battery_discharge_power_w',
  buyPower: 'grid_import_power_w',
  sellPower: 'grid_export_power_w',
};

function numeric(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeHyxiPowerHistory(response) {
  const data = response?.data;
  if (!data || !Array.isArray(data.timePoint)) throw new Error('Invalid HYXi power history');
  for (const key of Object.keys(fields)) {
    if (data[key] != null && !Array.isArray(data[key])) throw new Error('Invalid HYXi power series');
  }
  return data.timePoint.map((timePoint, index) => {
    const seconds = numeric(timePoint);
    const date = seconds === null ? null : new Date(seconds * 1000);
    if (!date || !Number.isFinite(date.getTime())) throw new Error('Invalid HYXi power timePoint');
    const raw_data = Object.fromEntries(Object.entries(data).map(([key, value]) => [
      key, Array.isArray(value) ? value[index] ?? null : value,
    ]));
    return {
      interval_start: date.toISOString(),
      timezone: data.timeZone ?? null,
      ...Object.fromEntries(Object.entries(fields).map(([key, column]) => [column, numeric(raw_data[key])])),
      raw_data,
    };
  });
}
