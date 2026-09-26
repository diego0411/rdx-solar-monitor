import { supabase } from '../config/supabase.js';

// Catálogo tarifario regulado (solo lectura para el portal).
// Las tarifas de planta siguen siendo manuales: tariff_category conserva TEXT.

export async function listEnergyDistributors() {
  const { data, error } = await supabase.from('energy_distributors')
    .select('id, code, name').eq('active', true).order('name', { ascending: true });
  if (error) throw new Error('No se pudo consultar el catálogo de distribuidoras');
  return data ?? [];
}

export async function listActiveTariffCategories(distributorId) {
  const { data, error } = await supabase.from('energy_tariff_categories')
    .select('id, code, name').eq('distributor_id', distributorId).eq('active', true)
    .order('code', { ascending: true });
  if (error) throw new Error('No se pudieron consultar las categorías tarifarias');
  return data ?? [];
}
