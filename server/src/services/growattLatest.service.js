import { upsertGrowattLatestData } from '../repositories/deviceLatestData.repository.js';
import { listActiveGrowattDevices } from '../repositories/devices.repository.js';
import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { normalizeGrowattLatestData } from '../providers/growatt/normalizeGrowattLatestData.js';
import { env } from '../config/env.js';

const provider = new GrowattProvider();

function getRows(payload, deviceType) {
  if (Array.isArray(payload?.data?.[deviceType])) return payload.data[deviceType];
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === 'object') {
    return Object.entries(payload.data).map(([deviceSn, data]) => ({ deviceSn, ...data }));
  }
  return [];
}

function serialOf(data, deviceType) {
  if (String(deviceType).toUpperCase() === 'MIN') return data?.serialNum;
  return data?.deviceSn ?? data?.device_sn ?? data?.sn ?? data?.serialNumber ?? data?.serialNum;
}

export async function syncGrowattLatest() {
  const devices = await listActiveGrowattDevices();
  const apiToken = env.GROWATT_API_TOKEN;
  const result = {
    processed: devices.length, updated: 0, no_data: 0, failed: 0, errors: [],
    rate_limited: false, permission_denied: false,
  };
  const groups = new Map();
  for (const device of devices) {
    const key = device.device_type ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ device, apiToken });
  }

  for (const group of groups.values()) {
    for (let offset = 0; offset < group.length; offset += 100) {
      const batch = group.slice(offset, offset + 100);
      const deviceType = batch[0].device.device_type ?? '';
      let rows;
      try {
        const response = await provider.queryLastData(
          deviceType, batch.map(({ device }) => device.serial_number), batch[0].apiToken,
        );
        if (response.rateLimited) result.rate_limited = true;
        if (response.permissionDenied) result.permission_denied = true;
        rows = getRows(response.payload, deviceType);
      } catch (error) {
        if (error.permissionDenied) {
          result.permission_denied = true;
          continue;
        }
        if (error.rateLimited) {
          result.rate_limited = true;
          result.no_data += batch.length;
        } else {
          result.failed += batch.length;
        }
        continue;
      }

      const bySerial = new Map(rows.map((row) => [String(serialOf(row, deviceType)), row]));
      for (const { device } of batch) {
        const data = bySerial.get(String(device.serial_number));
        if (!data) {
          result.no_data += 1;
          continue;
        }
        try {
          const normalized = normalizeGrowattLatestData(data, device.id);
          await upsertGrowattLatestData(normalized);
          result.updated += 1;
        } catch (error) {
          result.failed += 1;
        }
      }
    }
  }
  return result;
}
