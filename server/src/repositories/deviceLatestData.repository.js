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

export async function listDeviceLatestData(plantIds = null) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return [];
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from('device_latest_data')
      .select('*, device:devices!inner(serial_number, device_type, plant_id, plant:plants(name))')
      .order('device_id', { ascending: true });
    if (plantIds !== null && plantIds !== undefined) {
      query = query.in('device.plant_id', [...plantIds]);
    }
    const { data, error } = await query.range(offset, offset + pageSize - 1);
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
export async function listGrowattMinCurrentData(plantIds = null) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return [];
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from('device_latest_data')
      .select(`
        collected_at,
        raw_data,
        device:devices!inner(
          id,
          plant_id,
          provider,
          name,
          serial_number,
          device_type,
          active,
          plant:plants(id,name)
        )
      `)
      .eq('device.provider', 'growatt')
      .eq('device.active', true)
      .ilike('device.device_type', 'min');
    if (plantIds !== null && plantIds !== undefined) {
      query = query.in('device.plant_id', [...plantIds]);
    }
    const { data, error } = await query
      .order('device_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(
        `No se pudo consultar la telemetría actual Growatt: ${error.message}`
      );
    }

    rows.push(...data);

    if (data.length < pageSize) {
      return rows;
    }
  }
}