import { supabase } from '../config/supabase.js';
import { localDateKey } from '../utils/timezone.js';

// Proyección explícita día: derivaciones Growatt/HYXi necesitan id (linaje
// power_interval_id), interval_start/timezone, los 6 campos W
// (hasPowerValues evalúa también batería) y raw_data (contadores Growatt).
// Se eliminan plant_id/provider/created_at/updated_at, no consumidos.
const POWER_DAY_COLUMNS = 'id, interval_start, timezone, generation_power_w, consumption_power_w, battery_charge_power_w, battery_discharge_power_w, grid_import_power_w, grid_export_power_w, raw_data';
// Proyección explícita rango: solo alimenta aggregateHistory (4 campos W +
// interval_start/timezone); la respuesta construye buckets nuevos, por lo
// que raw_data/id/batería no viajan.
const POWER_RANGE_COLUMNS = 'interval_start, timezone, generation_power_w, consumption_power_w, grid_import_power_w, grid_export_power_w';

export async function upsertPlantPowerIntervals(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from('plant_power_intervals').upsert(rows, {
    onConflict: 'plant_id,interval_start',
  });
  if (error) throw new Error('No se pudo guardar la curva de potencia');
}

export async function latestPlantConsumption(plantId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('plant_power_intervals')
    .select('interval_start, consumption_power_w, timezone')
    .eq('plant_id', plantId)
    .gte('interval_start', since)
    .not('consumption_power_w', 'is', null)
    .order('interval_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('No se pudo consultar el consumo de planta');
  return data ?? null;
}

export async function listPlantPowerIntervals(plantId, startTime) {
  const start = Date.parse(`${startTime}T00:00:00.000Z`);
  // Pad UTC bounds for timezone offsets, then filter by the stored local date.
  const lower = new Date(start - 86400000).toISOString();
  const upper = new Date(start + 2 * 86400000).toISOString();
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('plant_power_intervals').select(POWER_DAY_COLUMNS)
      .eq('plant_id', plantId).gte('interval_start', lower).lt('interval_start', upper)
      .order('interval_start', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error('No se pudo consultar la curva de potencia');
    for (const row of data) {
      if (localDateKey(row.interval_start, row.timezone) === startTime) rows.push(row);
    }
    if (data.length < 1000) return rows;
  }
}

export async function listPlantPowerIntervalsRange(plantId, startDate, endDate) {
  const lower = new Date(Date.parse(`${startDate}T00:00:00.000Z`) - 86400000).toISOString();
  const upper = new Date(Date.parse(`${endDate}T00:00:00.000Z`) + 86400000).toISOString();
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('plant_power_intervals').select(POWER_RANGE_COLUMNS)
      .eq('plant_id', plantId).gte('interval_start', lower).lt('interval_start', upper)
      .order('interval_start', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error('No se pudo consultar la curva de potencia');
    for (const row of data) {
      const date = localDateKey(row.interval_start, row.timezone);
      if (date !== null && date >= startDate && date < endDate) rows.push(row);
    }
    if (data.length < 1000) return rows;
  }
}
