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

// Variante exclusiva para overview (lista y detalle): proyección explícita
// con las columnas consumidas por plantsOverview.service.js. Conserva
// raw_data y updated_at (consumo Growatt y señales de alarma vía
// growattDeviceState) y el device_type del join (la tabla no tiene esa
// columna: listDeviceLatestData lo denormaliza desde devices). Sin
// serial_number/plant_name, no consumidos en overview. La función
// compartida conserva su forma para GET /devices/latest y GET /devices.
const LATEST_OVERVIEW_COLUMNS = 'device_id, collected_at, updated_at, ac_power, pv_power, load_power, grid_power, grid_import_power, grid_export_power, battery_power, battery_charge_power, battery_discharge_power, battery_soc, today_energy, total_energy, raw_data, device:devices!inner(device_type)';

export async function listDeviceLatestDataOverview(plantIds = null) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return [];
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from('device_latest_data')
      .select(LATEST_OVERVIEW_COLUMNS)
      .order('device_id', { ascending: true });
    if (plantIds !== null && plantIds !== undefined) {
      query = query.in('device.plant_id', [...plantIds]);
    }
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudo consultar la última telemetría');
    rows.push(...data.map(({ device, ...latest }) => ({
      ...latest,
      device_type: device?.device_type ?? null,
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