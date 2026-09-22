import { supabase } from '../config/supabase.js';

export async function listUserProfiles() {
  const profiles = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('user_profiles')
      .select('id, client_id, role, display_name, active, created_at')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error('No se pudieron consultar los perfiles de usuario');

    profiles.push(...data);

    if (data.length < pageSize) return profiles;
  }
}

export async function getUserProfileById(id) {
  const { data, error } = await supabase.from('user_profiles')
    .select('id, client_id, role, display_name, active, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error('No se pudo consultar el perfil de usuario');

  return data;
}

export async function createUserProfile({ id, client_id, role, display_name }) {
  const { data, error } = await supabase.from('user_profiles')
    .insert({
      id,
      client_id,
      role,
      display_name: display_name ?? null,
      active: true,
    })
    .select('id, client_id, role, display_name, active, created_at')
    .single();

  if (error || !data) throw new Error('No se pudo crear el perfil de usuario');

  return data;
}

export async function updateUserProfile(id, values) {
  const { data, error } = await supabase.from('user_profiles')
    .update(values)
    .eq('id', id)
    .select('id, client_id, role, display_name, active, created_at')
    .single();

  if (error || !data) throw new Error('No se pudo actualizar el perfil de usuario');

  return data;
}

export async function clientExists(clientId) {
  const { data, error } = await supabase.from('clients')
    .select('id')
    .eq('id', clientId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error('No se pudo verificar el cliente');

  return data !== null;
}
