import { supabase } from '../config/supabase.js';

const impossibleId = '00000000-0000-0000-0000-000000000000';

export async function listMaintenanceVisits({
  plantIds = null, plantId = null, status = null, dateFrom = null, dateTo = null,
} = {}) {
  let query = supabase.from('maintenance_visits').select('*')
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (plantIds !== null && plantIds !== undefined) {
    query = plantIds.size === 0
      ? query.eq('id', impossibleId)
      : query.in('plant_id', [...plantIds]);
  }
  if (plantId) query = query.eq('plant_id', plantId);
  if (status) query = query.eq('status', status);
  if (dateFrom) query = query.gte('scheduled_at', dateFrom);
  if (dateTo) query = query.lte('scheduled_at', dateTo);

  const { data, error } = await query;
  if (error) throw new Error('No se pudieron consultar las visitas de mantenimiento');
  return data ?? [];
}

export async function getMaintenanceVisitById(id) {
  const { data, error } = await supabase.from('maintenance_visits')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo consultar la visita de mantenimiento');
  return data;
}

export async function insertMaintenanceVisit(values) {
  const { data, error } = await supabase.from('maintenance_visits')
    .insert(values).select('*').single();
  if (error || !data) throw new Error('No se pudo registrar la visita de mantenimiento');
  return data;
}

export async function updateMaintenanceVisit(id, values) {
  const { data, error } = await supabase.from('maintenance_visits')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single();
  if (error || !data) throw new Error('No se pudo actualizar la visita de mantenimiento');
  return data;
}
