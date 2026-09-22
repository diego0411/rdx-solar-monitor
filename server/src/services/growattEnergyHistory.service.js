import { listActiveGrowattMinDevicesByPlant } from '../repositories/devices.repository.js';
import { upsertEnergyIntervals } from '../repositories/energyIntervals.repository.js';
import { listPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';
import { syncGrowattPowerHistory } from './growattPowerHistory.service.js';

const cumulativeFields = {
  eacToday: 'generation_kwh',
  elocalLoadToday: 'consumption_kwh',
  etoUserToday: 'grid_import_kwh',
  etoGridToday: 'grid_export_kwh',
};

function nonNegativeNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function deviceRawData(row, device, deviceCount) {
  const entries = row.raw_data?.devices;
  if (Array.isArray(entries)) {
    return entries.find(entry => entry.device_id === device.id
      || entry.serial_number === device.serial_number)?.data ?? null;
  }
  return deviceCount === 1 ? row.raw_data ?? null : null;
}

function localDay(rawData) {
  return String(rawData?.time ?? '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

export function deriveGrowattEnergyHistory(plant, devices, powerRows) {
  const references = new Map();
  return [...powerRows].sort((left, right) => left.interval_start.localeCompare(right.interval_start))
    .map(row => {
      const contributions = Object.fromEntries(Object.values(cumulativeFields).map(field => [field, []]));
      for (const device of devices) {
        const rawData = deviceRawData(row, device, devices.length);
        const day = localDay(rawData);
        for (const [sourceField, targetField] of Object.entries(cumulativeFields)) {
          const key = `${device.id}:${sourceField}`;
          const current = nonNegativeNumber(rawData?.[sourceField]);
          const previous = references.get(key);
          let delta = null;
          if (day && current !== null) {
            if (previous?.day === day && current >= previous.value) delta = current - previous.value;
            references.set(key, { day, value: current });
          } else {
            references.delete(key);
          }
          contributions[targetField].push(delta);
        }
      }
      const energy = Object.fromEntries(Object.values(cumulativeFields).map(field => {
        const values = contributions[field];
        const complete = devices.length > 0 && values.length === devices.length
          && values.every(value => typeof value === 'number' && Number.isFinite(value));
        return [field, complete ? values.reduce((sum, value) => sum + value, 0) : null];
      }));
      return {
        plant_id: plant.id,
        provider: 'growatt',
        interval_type: 1,
        interval_start: row.interval_start,
        timezone: row.timezone ?? plant.timezone ?? 'UTC',
        ...energy,
        battery_charge_kwh: null,
        battery_discharge_kwh: null,
        raw_data: {
          derived_from: 'plant_power_intervals.raw_data',
          power_interval_id: row.id ?? null,
          devices: row.raw_data?.devices ?? null,
        },
        updated_at: new Date().toISOString(),
      };
    });
}

export async function syncGrowattEnergyHistory(plant, date) {
  let powerRows = await listPlantPowerIntervals(plant.id, date);
  let powerHistorySynced = false;
  if (!powerRows.length) {
    await syncGrowattPowerHistory(plant, date);
    powerHistorySynced = true;
    powerRows = await listPlantPowerIntervals(plant.id, date);
  }
  const devices = await listActiveGrowattMinDevicesByPlant(plant.id);
  const rows = deriveGrowattEnergyHistory(plant, devices, powerRows);
  await upsertEnergyIntervals(rows);
  return {
    provider: 'growatt', devices: devices.length, fetched: powerRows.length,
    upserted: rows.length, failed: 0, power_history_synced: powerHistorySynced,
  };
}
