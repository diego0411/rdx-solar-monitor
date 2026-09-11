export function deviceInfoToObject(data) {
  if (!Array.isArray(data) || data.some(item => !item || typeof item.dataKey !== 'string')) {
    throw new Error('Invalid HYXi device info');
  }
  return Object.fromEntries(data.map(({ dataKey, dataValue }) => [dataKey, dataValue]));
}

function numeric(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function deviceInfoTimestamp(value, timezone) {
  if (typeof value !== 'string' || typeof timezone !== 'string' || !timezone.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const local = Date.parse(`${value.replace(' ', 'T')}Z`);
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== value.replace(' ', 'T')) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const wallTime = timestamp => {
      const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(p => [p.type, p.value]));
      return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    };
    const offsets = new Set();
    for (const hours of [-36, 0, 36]) {
      const sample = local + hours * 3600000;
      offsets.add(wallTime(sample) - sample);
    }
    const candidates = [...offsets].map(offset => local - offset)
      .filter(timestamp => wallTime(timestamp) === local);
    // Reject nonexistent or ambiguous local times around daylight-saving transitions.
    return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
  } catch {
    return null;
  }
}

const deviceInfoStates = new Map([[1, 'online'], [2, 'offline'], [3, 'alarm'], [10, 'inactive']]);

export function normalizeHyxiDeviceInfo(data, timezone, metadata = {}) {
  const detail = deviceInfoToObject(data);
  const batteryCapacity = numeric(detail.batCap);
  return {
    name: detail.deviceName ?? null,
    model: detail.model ?? null,
    rated_power_w: numeric(detail.ratedPower),
    rated_voltage_v: numeric(detail.ratedVoltage),
    hardware_version: detail.hwVer ?? null,
    software_version: detail.swVerSys ?? null,
    parent_serial_number: detail.parentSn ?? null,
    pv_strings: numeric(detail.pvNum),
    battery_capacity_kwh: batteryCapacity > 0 ? batteryCapacity : null,
    last_data_at: deviceInfoTimestamp(detail.lastUpdateTime, timezone),
    status: deviceInfoStates.get(numeric(detail.deviceState)) ?? 'unknown',
    last_synced_at: new Date().toISOString(),
    metadata: { ...metadata, detail: { ...metadata?.detail, ...detail } },
  };
}
