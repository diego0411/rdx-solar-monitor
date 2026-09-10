import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiDeviceInfo } from '../providers/hyxi/normalizeHyxiDeviceInfo.js';
import { listActiveHyxiDevices, updateDeviceInfo } from '../repositories/devices.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiDeviceDetails() {
  const devices = await listActiveHyxiDevices();
  const result = { provider: 'hyxi', fetched: devices.length, updated: 0, failed: 0 };
  for (const device of devices) {
    try {
      const { data } = await provider.getDevice(device.serial_number);
      const detail = normalizeHyxiDeviceInfo(data, device.plant?.timezone, device.metadata);
      await updateDeviceInfo(device.id, detail);
      result.updated += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
