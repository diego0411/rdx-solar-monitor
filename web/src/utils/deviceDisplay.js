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
