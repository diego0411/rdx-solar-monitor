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

// Variante exclusiva para overview (lista y detalle): proyección explícita
// con plant_id y los 8 campos kWh consumidos por plantsOverview.service.js
// (sin el join plant:plants(name), no consumido en overview). La función
// compartida conserva su forma para GET /plants/energy-summaries.
const SUMMARIES_OVERVIEW_COLUMNS = 'plant_id, today_generation_kwh, month_generation_kwh, year_generation_kwh, total_generation_kwh, today_consumption_kwh, month_consumption_kwh, year_consumption_kwh, total_consumption_kwh';

export async function listPlantEnergySummariesOverview(plantIds = null) {
  if (plantIds !== null && plantIds !== undefined && plantIds.size === 0) return [];
  const summaries = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from('plant_energy_summary')
      .select(SUMMARIES_OVERVIEW_COLUMNS).order('plant_id', { ascending: true });
    if (plantIds !== null && plantIds !== undefined) {
      query = query.in('plant_id', [...plantIds]);
    }
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar los resúmenes energéticos');
    summaries.push(...data);
    if (data.length < pageSize) return summaries;
  }
}
