import { parseGrowattTimestamp } from './normalizeGrowattLatestData.js';

const fields = {
  ppv: 'generation_power_w',
  pacToLocalLoad: 'consumption_power_w',
  pacToUserTotal: 'grid_import_power_w',
  pacToGridTotal: 'grid_export_power_w',
  chargePowerOfBattery: 'battery_charge_power_w',
  disChargePowerOfBattery: 'battery_discharge_power_w',
};

function numeric(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pointsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data?.datas)) return payload.data.datas;
  return [];
}

export function normalizeGrowattPowerHistory(payload) {
  return pointsOf(payload).map(rawData => ({
    interval_start: parseGrowattTimestamp(rawData?.time),
    ...Object.fromEntries(Object.entries(fields).map(([source, target]) => [
      target, numeric(rawData?.[source]),
    ])),
    raw_data: rawData,
  })).filter(point => point.interval_start && Object.values(fields)
    .some(field => point[field] !== null));
}
