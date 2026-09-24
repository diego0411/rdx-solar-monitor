import { supabase } from '../config/supabase.js';

export async function listActiveHyxiPlants() {
  const plants = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('plants')
      .select('id, external_plant_id, name, timezone').eq('provider', 'hyxi').eq('active', true)
      .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar las plantas HYXi activas');
    plants.push(...data);
    if (data.length < pageSize) return plants;
  }
}

export async function getStoredPlantById(id) {
  const { data, error } = await supabase.from('plants')
    .select('id, provider, external_plant_id, active, timezone').eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo consultar la planta almacenada');
  return data;
}

export async function listActiveGrowattPlants() {
  const { data, error } = await supabase.from('plants')
    .select('id, external_plant_id, timezone').eq('provider', 'growatt').eq('active', true)
    .not('external_plant_id', 'is', null).order('id', { ascending: true });
  if (error) throw new Error('No se pudieron consultar las plantas Growatt activas');
  return data;
}

export async function updatePlantDetail(id, detail) {
  const { data, error } = await supabase.from('plants').update({
    plant_type: detail.plant_type,
    capacity_kwp: detail.capacity_kwp,
    timezone: detail.timezone,
    latitude: detail.latitude,
    longitude: detail.longitude,
    address: detail.address,
    last_synced_at: new Date().toISOString(),
  }).eq('id', id).eq('provider', 'hyxi').eq('active', true).select('id').single();
  if (error || !data) throw new Error('No se pudo actualizar el detalle de la planta HYXi');
}

export async function getActiveHyxiAccount() {
  const { data, error } = await supabase.from('integration_accounts')
    .select('id').eq('provider', 'hyxi').eq('active', true).limit(2);

  if (error) throw new Error('No se pudo consultar la cuenta de integración HYXi');
  if (!data?.length) {
    const missing = new Error('No existe un integration_account HYXi activo');
    missing.statusCode = 409;
    throw missing;
  }
  if (data.length > 1) {
    const ambiguous = new Error('Existe más de un integration_account HYXi activo; no se puede determinar cuál usar');
    ambiguous.statusCode = 409;
    throw ambiguous;
  }
  return data[0];
}

export async function getOrCreateGrowattAccount() {
  const { data, error } = await supabase.from('integration_accounts')
    .select('id').eq('provider', 'growatt').eq('active', true).limit(1);
  if (error) throw new Error('No se pudo consultar la cuenta de integración Growatt');
  if (data?.length) return data[0];

  const result = await supabase.from('integration_accounts').insert({
    provider: 'growatt', name: 'Growatt', active: true,
  }).select('id').single();
  if (result.error || !result.data) throw new Error('No se pudo crear la cuenta de integración Growatt');
  return result.data;
}

export async function upsertPlant(plant, integrationAccountId, lastSyncedAt) {
  const { error } = await supabase.from('plants').upsert({
    integration_account_id: integrationAccountId,
    provider: plant.provider,
    external_plant_id: plant.external_plant_id,
    name: plant.name,
    status: plant.status,
    capacity_kwp: plant.capacity_kwp,
    latitude: plant.latitude,
    longitude: plant.longitude,
    external_updated_at: plant.external_updated_at,
    last_data_at: plant.last_data_at,
    last_synced_at: lastSyncedAt,
    active: plant.active,
    metadata: plant.metadata,
  }, {
    onConflict: 'integration_account_id,provider,external_plant_id',
  });
  if (error) throw new Error('No se pudo guardar la planta en Supabase');
}

export async function upsertGrowattPlant(plant, integrationAccountId, lastSyncedAt) {
  const { data: existing, error: lookupError } = await supabase.from('plants')
    .select('id').eq('provider', 'growatt').eq('external_plant_id', plant.external_plant_id)
    .limit(1).maybeSingle();
  if (lookupError) throw new Error(`No se pudo consultar la planta Growatt: ${lookupError.message}`);

  const values = {
    integration_account_id: integrationAccountId,
    provider: plant.provider,
    external_plant_id: plant.external_plant_id,
    name: plant.name,
    status: plant.status,
    capacity_kwp: plant.capacity_kwp,
    latitude: plant.latitude,
    longitude: plant.longitude,
    last_data_at: plant.last_data_at,
    last_synced_at: lastSyncedAt,
    active: plant.active,
    metadata: plant.metadata,
  };
  if (existing) {
    const { error } = await supabase.from('plants').update(values).eq('id', existing.id);
    if (error) throw new Error(`No se pudo actualizar la planta Growatt: ${error.message}`);
    return 'updated';
  }
  const { error } = await supabase.from('plants').insert(values);
  if (error) throw new Error(`No se pudo insertar la planta Growatt: ${error.message}`);
  return 'inserted';
}

export async function listGrowattPlantsByUser(userName) {
  const { data, error } = await supabase.from('plants')
    .select('id, external_plant_id, metadata')
    .eq('provider', 'growatt').eq('active', true)
    .eq('metadata->>c_user_name', userName)
    .order('id', { ascending: true });
  if (error) throw new Error('No se pudieron consultar las plantas Growatt del usuario');
  return data ?? [];
}

export async function updateGrowattPlantMetadata(externalPlantId, metadata) {
  const { data, error } = await supabase.from('plants').update({ metadata })
    .eq('provider', 'growatt').eq('external_plant_id', externalPlantId).select('id').single();
  if (error || !data) throw new Error('No se pudo actualizar la metadata de la planta Growatt');
}

export async function updateGrowattPlantDetail(externalPlantId, detail) {
  const { data: existing, error: lookupError } = await supabase.from('plants')
    .select('id, timezone, address, plant_type, metadata')
    .eq('provider', 'growatt').eq('external_plant_id', externalPlantId)
    .limit(1).maybeSingle();
  if (lookupError) throw new Error(`No se pudo consultar la planta Growatt: ${lookupError.message}`);
  if (!existing) return;

  const values = {};
  if (detail.timezone) values.timezone = detail.timezone;
  if (detail.address) values.address = detail.address;
  if (detail.plant_type) values.plant_type = detail.plant_type;

  const metadata = { ...(existing.metadata ?? {}) };
  if (detail.metadata?.city) metadata.city = detail.metadata.city;
  if (detail.metadata?.country) metadata.country = detail.metadata.country;
  if (detail.metadata?.create_date) metadata.create_date = detail.metadata.create_date;
  if (JSON.stringify(metadata) !== JSON.stringify(existing.metadata ?? {})) values.metadata = metadata;

  if (!Object.keys(values).length) return;
  const { error } = await supabase.from('plants').update(values).eq('id', existing.id);
  if (error) throw new Error(`No se pudo actualizar el detalle de la planta Growatt: ${error.message}`);
}

/**
 * Lista las plantas almacenadas.
 *
 * @param {Set<string>|null} plantIds Alcance permitido. null = todas
 *        (rdx_admin); un Set vacío = ninguna; un Set con ids = solo esas.
 */
export async function listStoredPlants(plantIds = null) {
  const plants = [];
  const pageSize = 1000;
  let query = supabase.from('plants').select('*')
    .order('name', { ascending: true }).order('id', { ascending: true });

  if (plantIds !== null && plantIds !== undefined) {
    query = plantIds.size === 0
      ? query.eq('id', '00000000-0000-0000-0000-000000000000')
      : query.in('id', [...plantIds]);
  }

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error('No se pudieron consultar las plantas almacenadas');
    plants.push(...data);
    if (data.length < pageSize) return plants;
  }
}
