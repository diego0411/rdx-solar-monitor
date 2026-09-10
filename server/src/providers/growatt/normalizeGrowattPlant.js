export function normalizeGrowattPlant(plant, user = {}) {
  if (!plant || plant.plant_id === undefined || plant.plant_id === null
      || !String(plant.plant_id).trim() || typeof plant.name !== 'string' || !plant.name.trim()) {
    throw new Error('Invalid Growatt plant identity');
  }

  const status = new Map([
    ['1', 'online'], ['2', 'offline'], ['3', 'alarm'],
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
      user_id: user.user_id ?? user.userId ?? user.c_user_id ?? null,
      c_user_name: user.c_user_name ?? user.user_name ?? user.username ?? null,
    },
  };
}