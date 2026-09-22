import { listGrowattMinCurrentData } from '../repositories/deviceLatestData.repository.js';
import { isGrowattFault } from '../providers/growatt/growattStates.js';

export function createGrowattCurrentAlarmsService({ listLatest = listGrowattMinCurrentData } = {}) {
  return async function getCurrentGrowattAlarms(plantIds = null) {
    if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return { alarms: [] };
    const rows = await listLatest(plantIds);
    const alarms = [];
    for (const { device, collected_at, raw_data: raw } of rows) {
      if (device?.provider !== 'growatt' || device.active !== true
          || String(device.device_type).toUpperCase() !== 'MIN'
          || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      if (!isGrowattFault(raw)) continue;
      alarms.push({
        plant: device.plant ?? null,
        device: { id: device.id, name: device.name, serial_number: device.serial_number, device_type: device.device_type },
        collected_at,
        status: raw.status ?? null,
        faultType: raw.faultType ?? null,
        warnCode: raw.warnCode ?? null,
        errorText: raw.errorText ?? null,
        warnText: raw.warnText ?? null,
      });
    }
    return { alarms };
  };
}

export const getCurrentGrowattAlarms = createGrowattCurrentAlarmsService();
