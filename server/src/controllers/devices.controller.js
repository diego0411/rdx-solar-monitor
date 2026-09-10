import { listStoredDevices } from '../repositories/devices.repository.js';
import { listDeviceLatestData } from '../repositories/deviceLatestData.repository.js';
import { findDeviceDetail } from '../repositories/deviceDetail.repository.js';
import { telemetryFreshness } from '../services/telemetryFreshness.js';

export async function getDeviceDetail(req, res) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    return res.status(400).json({ error: 'Identificador de dispositivo inválido' });
  }
  try {
    const detail = await findDeviceDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Dispositivo no encontrado' });
    return res.json({ ...detail, ...telemetryFreshness(detail.device_latest_data?.collected_at ?? null) });
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar el detalle del dispositivo' });
  }
}

export async function getDevicesLatestData(req, res) {
  try {
    return res.json(await listDeviceLatestData());
  } catch {
    return res.status(503).json({ error: 'No se pudo consultar la última telemetría' });
  }
}

export async function getDevices(req, res) {
  try {
    const devices = await listStoredDevices();
    const fields = ['id', 'provider', 'serial_number', 'name', 'model', 'device_type',
      'status', 'active', 'plant_id', 'last_data_at', 'last_synced_at'];
    return res.json(devices.map(device => Object.fromEntries(fields.map(key => [key, device[key] ?? null]))));
  } catch {
    return res.status(503).json({ error: 'No se pudieron consultar los dispositivos almacenados' });
  }
}
