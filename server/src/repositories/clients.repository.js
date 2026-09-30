import { supabase } from '../config/supabase.js';

const managementSelect = 'id, name, active, created_at, updated_at';

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

export async function listAllClients() {
  const clients = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('clients')
      .select(managementSelect)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error('No se pudieron consultar los clientes');
    clients.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return clients;
  }
}

export async function getClientById(id) {
  const { data, error } = await supabase.from('clients')
    .select(managementSelect).eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo consultar el cliente');
  return data;
}

export async function insertClient(name) {
  const { data, error } = await supabase.from('clients')
    .insert({ name, active: true }).select(managementSelect).single();
  if (error || !data) throw new Error('No se pudo crear el cliente');
  return data;
}

export async function updateClient(id, values) {
  const { data, error } = await supabase.from('clients')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id).select(managementSelect).maybeSingle();
  if (error) throw new Error('No se pudo actualizar el cliente');
  return data;
}
