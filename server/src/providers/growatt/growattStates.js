import { telemetryFreshness } from '../../services/telemetryFreshness.js';

const FUTURE_WINDOW_MS = 10 * 60 * 1000;

function gmtOffsetMs(timezone) {
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/i.exec(String(timezone).trim());

  if (!match) return null;

  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');

  if (hours > 14 || minutes > 59) return null;

  // GMT-X significa wall = UTC - X, por lo que UTC = wall + X.
  const sign = match[1] === '-' ? 1 : -1;
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

function offsetForInstant(timezone, instantMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));

  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  if (!map.year || !map.month || !map.day || !map.hour || !map.minute || !map.second) {
    return null;
  }

  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const wallAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );

  return wallAsUtc - instantMs;
}

function ianaOffsetMs(timezone, wallAsUtc, fallback) {
  // offsetForInstant devuelve "wall - instant"; para pasar de wall a UTC
  // hay que sumar su opuesto.
  let offset = null;
  try {
    offset = -offsetForInstant(timezone, wallAsUtc);
  } catch {
    return fallback;
  }

  if (offset === null) return fallback;

  try {
    return -offsetForInstant(timezone, wallAsUtc + offset) ?? offset;
  } catch {
    return offset;
  }
}

function timezoneOffsetMs(timezone, wallAsUtc) {
  const value = String(timezone ?? '').trim();

  if (value === '' || value === 'UTC') return 0;

  const gmt = gmtOffsetMs(value);
  if (gmt !== null) return gmt;

  if (value.includes('/')) {
    return ianaOffsetMs(value, wallAsUtc, 0);
  }

  return 0;
}

/**
 * Interpreta el timestamp "wall-clock" que reporta Growatt usando la
 * timezone de la planta. Sin timezone válida se trata el valor como UTC.
 * Devuelve un ISO-8601 en UTC o null si no es un timestamp aprovechable
 * (formato inválido, calendario inválido o demasiado futuro).
 */
export function parseGrowattTimestamp(value, plantTimezone, now = Date.now()) {
  if (typeof value !== 'string') return null;

  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value.trim());

  if (!match) return null;

  const localTime = `${match[1]}T${match[2]}`;
  const wallAsUtc = Date.parse(`${localTime}Z`);

  if (!Number.isFinite(wallAsUtc)) return null;

  if (new Date(wallAsUtc).toISOString().slice(0, 19) !== localTime) return null;

  const offsetMs = timezoneOffsetMs(plantTimezone, wallAsUtc);
  const utc = wallAsUtc + offsetMs;

  if (utc <= now + FUTURE_WINDOW_MS) {
    return new Date(utc).toISOString();
  }

  return null;
}

/**
 * Regla única de incidencia Growatt: el mismo criterio que usa
 * growattCurrentAlarms.service.js (status 3/fault o códigos activos).
 */
export function isGrowattFault(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;

  const status = data.status;
  const statusIsFault =
    Number(status) === 3
    || (
      typeof status === 'string'
      && status.trim().toLowerCase() === 'fault'
    );

  return statusIsFault
    || Number(data.faultType ?? 0) > 0
    || Number(data.warnCode ?? 0) > 0;
}

function signalsOf(row) {
  const raw =
    row?.raw_data
    && typeof row.raw_data === 'object'
    && !Array.isArray(row.raw_data)
      ? row.raw_data
      : {};

  return {
    status: raw.status ?? row?.raw_status ?? null,
    statusText: raw.statusText ?? row?.raw_statusText ?? null,
    lost: raw.lost ?? row?.raw_lost ?? null,
    faultType: raw.faultType ?? null,
    warnCode: raw.warnCode ?? null,
  };
}

function isLost(signals) {
  return signals.lost === true
    || String(signals.lost ?? '').toLowerCase() === 'true';
}

function isNormal(signals) {
  const status = signals.status;

  if (
    typeof status === 'number'
    || (
      typeof status === 'string'
      && status.trim() !== ''
    )
  ) {
    return Number(status) === 1;
  }

  return typeof signals.statusText === 'string'
    && signals.statusText.trim().toLowerCase() === 'normal';
}

function effectiveTimestamp(row) {
  return row?.collected_at ?? row?.updated_at ?? null;
}

export function communicationStatus(row, now = Date.now()) {
  const timestamp = effectiveTimestamp(row);

  if (telemetryFreshness(timestamp, now).data_status === 'no_data') {
    return isLost(signalsOf(row)) ? 'disconnected' : 'unknown';
  }

  const signals = signalsOf(row);
  const fresh = telemetryFreshness(timestamp, now).data_status === 'fresh';

  if (fresh && isNormal(signals) && !isLost(signals)) {
    return 'connected';
  }

  // Sin timestamp, stale o con señales contradictorias: no se confirma nada.
  return 'unknown';
}

export function operationalStatus(row, now = Date.now()) {
  if (isGrowattFault(signalsOf(row))) return 'alarm';

  const timestamp = effectiveTimestamp(row);
  const status = telemetryFreshness(timestamp, now).data_status;

  if (status === 'no_data') return 'unavailable';
  if (status !== 'fresh') return 'unknown';

  const pv = Number(row?.pv_power);

  if (Number.isFinite(pv) && pv > 0) return 'producing';
  if (Number.isFinite(pv) && pv === 0) return 'idle';
  return 'unknown';
}

export function growattDeviceState(row, now = Date.now()) {
  if (!row) return 'unknown';

  if (operationalStatus(row, now) === 'alarm') return 'alarm';

  const comm = communicationStatus(row, now);
  return comm === 'connected' ? 'online'
    : comm === 'disconnected' ? 'offline'
    : 'unknown';
}

export function isSameCalendarDay(value, timezone, nowValue = Date.now()) {
  const date = value == null || !Number.isFinite(Date.parse(value))
    ? null
    : new Date(value);

  const now = new Date(nowValue);

  if (!date || !Number.isFinite(now.getTime())) return false;

  const zone = String(timezone ?? '').trim() === '' ? 'UTC' : String(timezone);

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatter.format(date); // validación de la zona
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  const dayOf = candidate =>
    formatter.formatToParts(candidate).map(part => part.value).join('-');

  return dayOf(date) === dayOf(now);
}