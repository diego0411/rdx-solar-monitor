import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { normalizeGrowattPowerHistory } from '../providers/growatt/normalizeGrowattPowerHistory.js';
import { listActiveGrowattMinDevicesByPlant } from '../repositories/devices.repository.js';
import { upsertPlantPowerIntervals } from '../repositories/plantPowerIntervals.repository.js';

const provider = new GrowattProvider();
const metricFields = [
  'generation_power_w',
  'consumption_power_w',
  'grid_import_power_w',
  'grid_export_power_w',
  'battery_charge_power_w',
  'battery_discharge_power_w',
];

export function aggregateGrowattPowerHistory(plant, devices, pointsByDevice) {
  const timestamps = [...new Set([...pointsByDevice.values()]
    .flatMap(points => points.map(point => point.interval_start)))].sort();
  return timestamps.map(intervalStart => {
    const aligned = devices.map(device => pointsByDevice.get(device.id)
      ?.find(point => point.interval_start === intervalStart));
    return {
      plant_id: plant.id,
      provider: 'growatt',
      interval_start: intervalStart,
      timezone: plant.timezone ?? 'America/La_Paz',
      ...Object.fromEntries(metricFields.map(field => {
        const values = aligned.map(point => point?.[field]);
        return [field, values.every(value => typeof value === 'number' && Number.isFinite(value))
          ? values.reduce((total, value) => total + value, 0) : null];
      })),
      raw_data: {
        devices: devices.map((device, index) => ({
          device_id: device.id,
          serial_number: device.serial_number,
          data: aligned[index]?.raw_data ?? null,
        })),
      },
    };
  });
}

export async function syncGrowattPowerHistory(plant, date) {
  const devices = await listActiveGrowattMinDevicesByPlant(plant.id);
  const pointsByDevice = new Map();
  const result = { provider: 'growatt', devices: devices.length, fetched: 0, upserted: 0, failed: 0 };

  for (const device of devices) {
    try {
      const payload = await provider.queryHistoricalData(device.serial_number, date);
      const points = normalizeGrowattPowerHistory(payload);
      pointsByDevice.set(device.id, points);
      result.fetched += points.length;
    } catch (error) {
      if (error?.frequentAccess) throw error;
      pointsByDevice.set(device.id, []);
      result.failed += 1;
    }
  }

  const rows = aggregateGrowattPowerHistory(plant, devices, pointsByDevice);
  await upsertPlantPowerIntervals(rows);
  result.upserted = rows.length;
  return result;
}
