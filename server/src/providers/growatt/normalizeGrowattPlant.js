const GROWATT_PLANT_TYPE = new Map([
  [0, 'residential'], [1, 'commercial'], [2, 'ground_mounted'],
  ['0', 'residential'], ['1', 'commercial'], ['2', 'ground_mounted'],
]);

function validText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.toLowerCase() !== 'null' ? trimmed : null;
}

export function normalizeGrowattPlantDetails(details = {}) {
  return {
    timezone: validText(details.timezone),
    address: validText(details.address1),
    plant_type: GROWATT_PLANT_TYPE.get(details.plant_type) ?? null,
    metadata: {
      city: validText(details.city),
      country: validText(details.country),
      create_date: validText(details.create_date),
    },
  };
}

export function normalizeGrowattPlant(plant, user = {}) {
  if (!plant || plant.plant_id === undefined || plant.plant_id === null
      || !String(plant.plant_id).trim() || typeof plant.name !== 'string' || !plant.name.trim()) {
    throw new Error('Invalid Growatt plant identity');
  }

  const status = new Map([
    ['1', 'online'], ['2', 'offline'], ['3', 'alarm'], ['4', 'offline'],
    ['online', 'online'], ['offline', 'offline'], ['alarm', 'alarm'],
  ]).get(String(plant.status).toLowerCase()) ?? 'unknown';

  return {
    provider: 'growatt',
    external_plant_id: String(plant.plant_id),
    name: plant.name,
    status,
    capacity_kwp: plant.peak_power == null ? null : Number(plant.peak_power),
    latitude: plant.latitude == null ? null : Number(plant.latitude),
    longitude: plant.longitude == null ? null : Number(plant.longitude),
    last_data_at: plant.last_data_at ?? null,
    active: true,
    metadata: {
      ...plant,
      provider_plant_status: plant.status ?? null,
      user_id: user.user_id ?? user.userId ?? user.c_user_id ?? null,
      c_user_name: user.c_user_name ?? user.user_name ?? user.username ?? null,
    },
  };
}