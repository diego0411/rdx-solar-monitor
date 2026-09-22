import { supabase } from '../config/supabase.js';

export async function upsertPlantEnergySummary(summary) {
  const { error } = await supabase.from('plant_energy_summary').upsert({
    ...summary,
    updated_at: summary.last_synced_at,
  }, { onConflict: 'plant_id' });
  if (error) throw new Error('No se pudo guardar el resumen energético');
}

export async function listPlantEnergySummaries(plantIds = null) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return [];
  const summaries = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from('plant_energy_summary')
      .select('*, plant:plants(name)').order('plant_id', { ascending: true });
    if (plantIds !== null && plantIds !== undefined) {
      query = query.in('plant_id', [...plantIds]);
    }
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar los resúmenes energéticos');
    summaries.push(...data);
    if (data.length < pageSize) return summaries;
  }
}
