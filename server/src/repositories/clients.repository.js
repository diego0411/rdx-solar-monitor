import { supabase } from '../config/supabase.js';

export async function listActiveClients() {
  const { data, error } = await supabase.from('clients')
    .select('id, name')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) throw new Error('No se pudieron consultar los clientes');

  return data ?? [];
}

export async function listClientPlantAssignments() {
  const assignments = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('client_plants')
      .select('client_id, plant_id')
      .order('client_id', { ascending: true })
      .order('plant_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error('No se pudieron consultar las plantas por cliente');
    assignments.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return assignments;
  }
}
