function coordinate(value, limit) {
  if ((typeof value !== 'string' && typeof value !== 'number')
      || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

export function normalizeHyxiPlantDetail(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || !Object.keys(data).length) {
    throw new Error('Invalid HYXi plant detail');
  }

  return {
    plant_type: data.plantType ?? null,
    capacity_kwp: data.capacity == null ? null
      : data.capacity >= 1000 ? data.capacity / 1000 : data.capacity,
    timezone: data.timeZone ?? null,
    latitude: coordinate(data.location?.lat, 90),
    longitude: coordinate(data.location?.lng, 180),
    address: data.location?.address ?? null,
  };
}
