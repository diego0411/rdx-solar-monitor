import { normalizeGrowattDeviceCheck } from './normalizeGrowattDeviceCheck.js';

export function normalizeGrowattDiscovery(entry, plantId, existing, identification) {
  const serial = String(entry?.device_sn ?? '').trim();
  if (!serial || serial.toLowerCase() === 'meter') return null;
  const check = normalizeGrowattDeviceCheck(identification);
  // Only an identified MIN model establishes the family; v1 numeric types do not.
  const knownMin = String(existing?.device_type ?? '').toLowerCase() === 'min';
  if (!knownMin && !(check.valid && /^MIN\s/i.test(check.model ?? ''))) return null;
  const metadata = { ...(existing?.metadata ?? {}) };
  for (const [from, to] of [['type', 'v1_type'], ['device_id', 'v1_device_id'],
    ['status', 'v1_status'], ['datalogger_sn', 'datalogger_sn']]) {
    if (entry[from] !== null && entry[from] !== undefined && entry[from] !== '') metadata[to] = entry[from];
  }
  if (check.valid) {
    for (const [from, to] of [['deviceType', 'check_device_type'], ['dtc', 'dtc'], ['haveMeter', 'have_meter']]) {
      if (check.metadata[from] !== undefined) metadata[to] = check.metadata[from];
    }
  }
  return {
    provider: 'growatt', external_device_id: existing?.external_device_id || serial,
    serial_number: serial, plant_id: plantId, device_type: 'min', active: true, metadata,
    ...(check.valid && check.model ? { model: check.model } : {}),
    ...(check.valid && check.rated_power_w !== null ? { rated_power_w: check.rated_power_w } : {}),
  };
}
