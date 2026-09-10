import { supabase } from '../config/supabase.js';

export async function upsertDeviceLatestData(data) {
  const { error } = await supabase.from('device_latest_data').upsert({
    ...data,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'device_id' });
  if (error) throw new Error('No se pudo guardar la telemetría HYXi');
}

export async function upsertGrowattLatestData(data) {
  const { error } = await supabase.from('device_latest_data').upsert({
    ...data,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'device_id' });
  if (error) throw new Error(`No se pudo guardar la telemetría Growatt: ${error.message}`);
}

export async function listDeviceLatestData() {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('device_latest_data')
      .select('*, device:devices(serial_number, device_type, plant:plants(name))')
      .order('device_id', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudo consultar la última telemetría');
    rows.push(...data.map(({ device, ...latest }) => ({
      ...latest,
      serial_number: device?.serial_number ?? null,
      device_type: device?.device_type ?? null,
      plant_name: device?.plant?.name ?? null,
    })));
    if (data.length < pageSize) return rows;
  }
}
