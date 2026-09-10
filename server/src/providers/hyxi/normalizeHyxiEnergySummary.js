const fields = {
  todayYield: 'today_generation_kwh',
  monthYield: 'month_generation_kwh',
  yearYield: 'year_generation_kwh',
  totalYield: 'total_generation_kwh',
  todayConsume: 'today_consumption_kwh',
  monthConsume: 'month_consumption_kwh',
  yearConsume: 'year_consumption_kwh',
  totalConsume: 'total_consumption_kwh',
};

function numeric(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeHyxiEnergySummary(response, plantId) {
  const data = response?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid HYXi energy summary');
  }
  return {
    plant_id: plantId,
    provider: 'hyxi',
    ...Object.fromEntries(Object.entries(fields).map(([key, column]) => [column, numeric(data[key])])),
    last_synced_at: new Date().toISOString(),
    raw_data: response,
  };
}
