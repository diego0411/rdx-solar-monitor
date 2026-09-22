import { supabase } from '../config/supabase.js';
import { localDateKey } from '../utils/timezone.js';

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
    const { data, error } = await supabase.from('plant_power_intervals').select('*')
      .eq('plant_id', plantId).gte('interval_start', lower).lt('interval_start', upper)
      .order('interval_start', { ascending: true }).range(offset, offset + 999);
    if (error) throw new Error('No se pudo consultar la curva de potencia');
    for (const row of data) {
      if (localDateKey(row.interval_start, row.timezone) === startTime) rows.push(row);
    }
    if (data.length < 1000) return rows;
  }
}
