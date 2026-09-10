import { supabase } from '../config/supabase.js';

export async function findDeviceDetail(id) {
  const { data: device, error } = await supabase.from('devices')
    .select('id, provider, serial_number, name, model, device_type, status, active, plant_id, rated_power_w, software_version, last_data_at, last_synced_at, plant:plants(id, name, provider, status, timezone)')
    .eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo consultar el dispositivo');
  if (!device) return null;
  const { data: latest, error: latestError } = await supabase.from('device_latest_data')
    .select('*').eq('device_id', id).maybeSingle();
  if (latestError) throw new Error('No se pudo consultar la telemetría');
  const { plant, ...identity } = device;
  return { device: identity, plant, device_latest_data: latest };
}
