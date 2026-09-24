import { supabase } from '../config/supabase.js';

const fields = [
  'installed_at', 'panel_manufacturer', 'panel_model', 'panel_count',
  'panel_power_w', 'orientation', 'tilt_degrees',
].join(', ');

export async function getPlantInstallationDetails(plantId) {
  const { data, error } = await supabase.from('plant_installation_details')
    .select(fields).eq('plant_id', plantId).maybeSingle();
  if (error) throw new Error('No se pudo consultar la información de instalación');
  return data;
}

export async function upsertPlantInstallationDetails(plantId, values) {
  const { data, error } = await supabase.from('plant_installation_details').upsert({
    plant_id: plantId, ...values, updated_at: new Date().toISOString(),
  }, { onConflict: 'plant_id' }).select(fields).single();
  if (error || !data) throw new Error('No se pudo guardar la información de instalación');
  return data;
}
