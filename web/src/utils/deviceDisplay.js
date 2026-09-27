const PROVIDER_LABELS = { growatt: 'Growatt', hyxi: 'HYXi' };

// Nombre a mostrar para un dispositivo sin inventar datos en BD:
// - Growatt no entrega name para los MIN (solo alias vía queryLastData,
//   que se persiste cuando existe), por lo que un MIN sin nombre
//   se muestra como "Inversor Growatt".
// - Otros tipos sin nombre conservan el comportamiento previo
//   (número de serie) y solo usan device_type como último recurso.
export function deviceDisplayName(device, generic = 'Dispositivo sin nombre') {
  if (device?.name) return device.name;
  const provider = String(device?.provider ?? '').toLowerCase();
  const deviceType = device?.device_type != null ? String(device.device_type) : '';
  if (provider === 'growatt' && deviceType.toUpperCase() === 'MIN') return 'Inversor Growatt';
  if (device?.serial_number) return device.serial_number;
  if (deviceType) {
    const label = PROVIDER_LABELS[provider];
    return label ? `Dispositivo ${label} ${deviceType}` : `Dispositivo ${deviceType}`;
  }
  return generic;
}

// Clasificación visual V1 del filtro Tipo (solo presentación, no cambia
// el device_type persistido): On-Grid agrupa STRING_INVERTER, INVERTER y
// MIN; SPH y cualquier tipo futuro no reconocido conservan su propia
// opción fallback para no desaparecer del filtro.
const DEVICE_TYPE_CATEGORY_LABELS = {
  on_grid: 'Inversor On-Grid',
  hybrid: 'Inversor híbrido',
  communicator: 'Comunicador',
};

const DEVICE_TYPE_CATEGORY_MEMBERS = {
  on_grid: ['STRING_INVERTER', 'INVERTER', 'MIN'],
  hybrid: ['HYBRID_INVERTER'],
  communicator: ['COLLECTOR'],
};

export const DEVICE_TYPE_CATEGORY_ORDER = ['on_grid', 'hybrid', 'communicator'];

export function normalizeDeviceType(deviceType) {
  return String(deviceType ?? '').trim().toUpperCase();
}

export function deviceTypeCategory(deviceType) {
  const normalized = normalizeDeviceType(deviceType);
  if (!normalized) return null;
  for (const [category, members] of Object.entries(DEVICE_TYPE_CATEGORY_MEMBERS)) {
    if (members.includes(normalized)) return category;
  }
  return `unknown:${normalized}`;
}

export function deviceTypeCategoryLabel(category) {
  if (!category) return '—';
  if (DEVICE_TYPE_CATEGORY_LABELS[category]) return DEVICE_TYPE_CATEGORY_LABELS[category];
  if (category.startsWith('unknown:')) return category.slice('unknown:'.length);
  return category;
}

export function deviceTypeLabel(deviceType) {
  return deviceTypeCategoryLabel(deviceTypeCategory(deviceType));
}

export function visibleDeviceTypeCategories(devices) {
  const seen = new Set();
  for (const device of devices ?? []) {
    const category = deviceTypeCategory(device?.device_type);
    if (category) seen.add(category);
  }
  return [...seen].sort((left, right) => {
    const orderLeft = DEVICE_TYPE_CATEGORY_ORDER.indexOf(left);
    const orderRight = DEVICE_TYPE_CATEGORY_ORDER.indexOf(right);
    if (orderLeft === -1 && orderRight === -1) return left.localeCompare(right);
    if (orderLeft === -1) return 1;
    if (orderRight === -1) return -1;
    return orderLeft - orderRight;
  });
}

export function deviceInCategory(device, category) {
  if (!category) return true;
  return deviceTypeCategory(device?.device_type) === category;
}
