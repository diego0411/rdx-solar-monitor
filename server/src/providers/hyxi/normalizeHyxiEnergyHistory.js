const fields = {
  yield: 'generation_kwh',
  consume: 'consumption_kwh',
  charged: 'battery_charge_kwh',
  discharged: 'battery_discharge_kwh',
  buyYield: 'grid_import_kwh',
  sellYield: 'grid_export_kwh',
};

function numeric(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeHyxiEnergyHistory(response) {
  const data = response?.data;
  if (!data || !Array.isArray(data.timePoint)) {
    throw new Error('Invalid HYXi energy history');
  }
  for (const key of Object.keys(fields)) {
    if (data[key] != null
        && (!Array.isArray(data[key]) || data[key].length !== data.timePoint.length)) {
      throw new Error('Invalid HYXi energy history series');
    }
  }
  return {
    timeZone: data.timeZone ?? null,
    points: data.timePoint.map((timePoint, index) => {
      const seconds = numeric(timePoint);
      const date = seconds === null ? null : new Date(seconds * 1000);
      if (!date || !Number.isFinite(date.getTime())) {
        throw new Error('Invalid HYXi energy history timePoint');
      }
      // HYXi returns parallel series; preserve each original value at this index.
      const raw_data = Object.fromEntries(Object.entries(data).map(([key, value]) => [
        key, Array.isArray(value) ? value[index] : value,
      ]));
      return {
        timestamp: date.toISOString(),
        ...Object.fromEntries(Object.entries(fields).map(([key, column]) => [
          column, numeric(raw_data[key]),
        ])),
        raw_data,
      };
    }),
  };
}
