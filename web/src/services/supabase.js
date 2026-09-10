import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
}) : null;

export async function getSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  return error ? null : data.session;
}
