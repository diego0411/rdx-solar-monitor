import { supabase } from '../config/supabase.js';

export async function listActivitiesByVisitId(visitId) {
  const { data, error } = await supabase.from('maintenance_activities')
    .select('*').eq('maintenance_visit_id', visitId)
    .order('created_at', { ascending: true });
  if (error) throw new Error('No se pudieron consultar las actividades de mantenimiento');
  return data ?? [];
}

export async function getMaintenanceActivityById(id) {
  const { data, error } = await supabase.from('maintenance_activities')
    .select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo consultar la actividad de mantenimiento');
  return data;
}

export async function insertMaintenanceActivity(values) {
  const { data, error } = await supabase.from('maintenance_activities')
    .insert(values).select('*').single();
  if (error || !data) throw new Error('No se pudo registrar la actividad de mantenimiento');
  return data;
}

export async function updateMaintenanceActivity(id, values) {
  const { data, error } = await supabase.from('maintenance_activities')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id).select('*').single();
  if (error || !data) throw new Error('No se pudo actualizar la actividad de mantenimiento');
  return data;
}

export async function deleteMaintenanceActivity(id) {
  const { error } = await supabase.from('maintenance_activities')
    .delete().eq('id', id);
  if (error) throw new Error('No se pudo eliminar la actividad de mantenimiento');
}

export async function getDevicePlant(deviceId) {
  const { data, error } = await supabase.from('devices')
    .select('id, plant_id').eq('id', deviceId).maybeSingle();
  if (error) throw new Error('No se pudo consultar el dispositivo');
  return data;
}
