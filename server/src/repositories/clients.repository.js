import { supabase } from '../config/supabase.js';

export async function listActiveClients() {
  const { data, error } = await supabase.from('clients')
    .select('id, name')
    .eq('active', true)
    .order('name', { ascending: true });

  if (error) throw new Error('No se pudieron consultar los clientes');

  return data ?? [];
}
