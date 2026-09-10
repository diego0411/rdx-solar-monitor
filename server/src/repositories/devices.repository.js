import { supabase } from '../config/supabase.js';

export async function listActiveHyxiDevices() {
  const devices = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('devices')
      .select('id, serial_number, device_type, metadata, plant:plants(timezone)')
      .eq('provider', 'hyxi').eq('active', true)
      .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar los dispositivos HYXi activos');
    devices.push(...data);
    if (data.length < pageSize) return devices;
  }
}

export async function listActiveGrowattDevices() {
  const devices = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('devices')
      .select('id, serial_number, device_type, active')
      .eq('provider', 'growatt').eq('active', true)
      .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`No se pudieron consultar los dispositivos Growatt: ${error.message}`);
    devices.push(...data);
    if (data.length < pageSize) return devices;
  }
}

export async function updateDeviceInfo(id, detail) {
  const { data, error } = await supabase.from('devices').update(detail)
    .eq('id', id).eq('provider', 'hyxi').eq('active', true).select('id').single();
  if (error || !data) throw new Error('No se pudo actualizar el detalle del dispositivo HYXi');
}

export async function upsertDevice(device) {
  const { error } = await supabase.from('devices').upsert(device, {
    onConflict: 'plant_id,serial_number',
  });
  if (error) throw new Error('No se pudo guardar el dispositivo en Supabase');
}

export async function upsertGrowattDevice(device) {
  const { data: existing, error: lookupError } = await supabase.from('devices')
    .select('id').eq('provider', 'growatt')
    .eq('external_device_id', device.external_device_id).limit(1).maybeSingle();
  if (lookupError) throw new Error(`No se pudo consultar el dispositivo Growatt: ${lookupError.message}`);

  if (existing) {
    const { error } = await supabase.from('devices').update(device).eq('id', existing.id);
    if (error) throw new Error(`No se pudo actualizar el dispositivo Growatt: ${error.message}`);
    return 'updated';
  }

  const { error } = await supabase.from('devices').insert(device);
  if (error) throw new Error(`No se pudo insertar el dispositivo Growatt: ${error.message}`);
  return 'inserted';
}

export async function listStoredDevices() {
  const devices = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('devices').select('*, plant:plants(name)')
      .order('name', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar los dispositivos almacenados');
    devices.push(...data);
    if (data.length < pageSize) return devices;
  }
}
