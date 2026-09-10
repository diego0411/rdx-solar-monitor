export function normalizeHyxiPlant(plant) {
  if (!plant || !['string', 'number'].includes(typeof plant.plantId)
      || !String(plant.plantId).trim() || typeof plant.plantName !== 'string'
      || !plant.plantName.trim()) {
    throw new Error('Invalid HYXi plant identity');
  }

  let externalUpdatedAt = null;
  if (plant.updateTime !== undefined && plant.updateTime !== null) {
    // HYXi returns updateTime as Unix milliseconds.
    if (typeof plant.updateTime !== 'number' || !Number.isFinite(plant.updateTime)) {
      throw new Error('Invalid HYXi plant updateTime');
    }
    externalUpdatedAt = new Date(plant.updateTime).toISOString();
  }

  return {
    external_plant_id: String(plant.plantId),
    name: plant.plantName,
    status: new Map([[1, 'online'], [2, 'offline'], [3, 'alarm']]).get(plant.plantState) ?? 'unknown',
    external_updated_at: externalUpdatedAt,
    provider: 'hyxi',
    active: true,
    metadata: plant,
  };
}
