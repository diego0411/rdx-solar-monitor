import { supabase } from '../config/supabase.js';

const fields = 'id, plant_id, effective_from, effective_to, purchase_energy_rate, export_energy_rate, currency, export_compensation_type, distributor, tariff_category, created_at, updated_at';

function tariffError(error) {
  const failure = new Error(error?.code === '23P01'
    ? 'La vigencia se solapa con otra tarifa de la planta'
    : 'No se pudo guardar la tarifa de energía');
  failure.statusCode = error?.code === '23P01' || error?.code === '23505' ? 409 : 503;
  return failure;
}

export async function listPlantEnergyTariffs(plantId) {
  const { data, error } = await supabase.from('plant_energy_tariffs').select(fields)
    .eq('plant_id', plantId).order('effective_from', { ascending: false });
  if (error) throw new Error('No se pudieron consultar las tarifas de energía');
  return data ?? [];
}

export async function listPlantEnergyTariffsForRange(plantId, startDate, endDate) {
  const { data, error } = await supabase.from('plant_energy_tariffs').select(fields)
    .eq('plant_id', plantId)
    .lt('effective_from', endDate)
    .or(`effective_to.is.null,effective_to.gte.${startDate}`)
    .order('effective_from', { ascending: true });
  if (error) throw new Error('No se pudieron consultar las tarifas de energía');
  return data ?? [];
}

export async function createPlantEnergyTariff(plantId, values) {
  const { data, error } = await supabase.from('plant_energy_tariffs').insert({
    plant_id: plantId,
    ...values,
  }).select(fields).single();
  if (error || !data) throw tariffError(error);
  return data;
}

export async function getPlantEnergyTariff(plantId, tariffId) {
  const { data, error } = await supabase.from('plant_energy_tariffs').select(fields)
    .eq('plant_id', plantId).eq('id', tariffId).maybeSingle();
  if (error) throw new Error('No se pudo consultar la tarifa de energía');
  return data;
}

export async function updatePlantEnergyTariff(plantId, tariffId, values) {
  const { data, error } = await supabase.from('plant_energy_tariffs').update({
    ...values,
    updated_at: new Date().toISOString(),
  }).eq('plant_id', plantId).eq('id', tariffId).select(fields).maybeSingle();
  if (error) throw tariffError(error);
  return data;
}
