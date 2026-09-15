import { supabase } from '../config/supabase.js';

const fields = 'baseline_monthly_bill, purchase_energy_rate, export_energy_rate, installation_date, system_investment';

export async function getPlantFinancialProfile(plantId) {
  const { data, error } = await supabase.from('plant_financial_profiles')
    .select(fields).eq('plant_id', plantId).maybeSingle();
  if (error) throw new Error('No se pudo consultar el perfil financiero de la planta');
  return data;
}

export async function upsertPlantFinancialProfile(plantId, values) {
  const { data, error } = await supabase.from('plant_financial_profiles').upsert({
    plant_id: plantId,
    ...values,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'plant_id' }).select(fields).single();
  if (error || !data) throw new Error('No se pudo guardar el perfil financiero de la planta');
  return data;
}
