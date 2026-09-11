import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiDeviceRealtime } from '../providers/hyxi/normalizeHyxiDeviceRealtime.js';
import { listActiveHyxiDevices, updateDeviceInfo } from '../repositories/devices.repository.js';
import { upsertDeviceLatestData } from '../repositories/deviceLatestData.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiRealtime() {
  const devices = (await listActiveHyxiDevices()).filter(device =>
    device.device_type === 'STRING_INVERTER' || device.device_type === 'HYBRID_INVERTER');
  const result = { provider: 'hyxi', fetched: devices.length, updated: 0, failed: 0 };
  for (const device of devices) {
    try {
      const { data } = await provider.getDeviceRealtime(device.serial_number);
      const latest = normalizeHyxiDeviceRealtime(data, device.id);
      await upsertDeviceLatestData(latest);
      if (latest.collected_at) {
        await updateDeviceInfo(device.id, {
          status: latest.device_status,
          last_data_at: latest.collected_at,
        });
      }
      result.updated += 1;
    } catch (error) {
      console.error('HYXi realtime device sync failed:', {
        serial_number: device.serial_number,
        message: error.message,
        http_status: error.status ?? error.statusCode ?? null,
        provider_code: error.providerCode ?? null,
        provider_msg: error.providerMsg ?? null,
      });
      result.failed += 1;
    }
  }
  return result;
}
