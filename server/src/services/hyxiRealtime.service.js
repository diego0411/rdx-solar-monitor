import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiDeviceRealtime } from '../providers/hyxi/normalizeHyxiDeviceRealtime.js';
import { listActiveHyxiDevices } from '../repositories/devices.repository.js';
import { upsertDeviceLatestData } from '../repositories/deviceLatestData.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiRealtime() {
  const devices = (await listActiveHyxiDevices()).filter(device =>
    device.device_type === 'STRING_INVERTER' || device.device_type === 'HYBRID_INVERTER');
  const result = { provider: 'hyxi', fetched: devices.length, updated: 0, failed: 0 };
  for (const device of devices) {
    try {
      const { data } = await provider.getDeviceRealtime(device.serial_number);
      await upsertDeviceLatestData(normalizeHyxiDeviceRealtime(data, device.id));
      result.updated += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
