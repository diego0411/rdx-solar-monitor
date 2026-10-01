import { supabase } from '../config/supabase.js';

export async function listUserPlantIds(userId) {
  const ids = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('user_plants')
      .select('plant_id')
      .eq('user_id', userId)
      .order('plant_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error('No se pudieron consultar las plantas del usuario');

    ids.push(...(data ?? []).map(row => row.plant_id));

    if ((data?.length ?? 0) < pageSize) return ids;
  }
}

export async function listAllUserPlants() {
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('user_plants')
      .select('user_id, plant_id')
      .order('user_id', { ascending: true })
      .order('plant_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error('No se pudieron consultar las asignaciones de plantas');

    rows.push(...(data ?? []));

    if ((data?.length ?? 0) < pageSize) return rows;
  }
}

export async function replaceUserPlants(userId, plantIds) {
  const { error: deleteError } = await supabase.from('user_plants')
    .delete()
    .eq('user_id', userId);

  if (deleteError) throw new Error('No se pudieron actualizar las plantas del usuario');

  if (plantIds.length === 0) return [];

  const { data, error: insertError } = await supabase.from('user_plants')
    .insert(plantIds.map(plant_id => ({ user_id: userId, plant_id })))
    .select('plant_id');

  if (insertError || !data) throw new Error('No se pudieron actualizar las plantas del usuario');

  return data.map(row => row.plant_id);
}
