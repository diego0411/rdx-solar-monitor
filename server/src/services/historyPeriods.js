const fieldsByKind = {
  power: ['generation_power_w', 'consumption_power_w', 'grid_import_power_w', 'grid_export_power_w'],
  energy: ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh'],
};

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function periodRange(period, selectedDate) {
  const selected = new Date(`${selectedDate}T00:00:00.000Z`);
  if (period === 'day') return { start: selectedDate, end: addDays(selectedDate, 1), bucket: 'intraday' };
  if (period === 'week') {
    const mondayOffset = (selected.getUTCDay() + 6) % 7;
    selected.setUTCDate(selected.getUTCDate() - mondayOffset);
    const start = isoDate(selected);
    return { start, end: addDays(start, 7), bucket: 'day' };
  }
  if (period === 'month') {
    selected.setUTCDate(1);
    const start = isoDate(selected);
    selected.setUTCMonth(selected.getUTCMonth() + 1);
    return { start, end: isoDate(selected), bucket: 'day' };
  }
  selected.setUTCMonth(0, 1);
  const start = isoDate(selected);
  selected.setUTCFullYear(selected.getUTCFullYear() + 1);
  return { start, end: isoDate(selected), bucket: 'month' };
}

export function energyTimeType(period) {
  if (period === 'month') return 2;
  if (period === 'year') return 3;
  return 1;
}

export function hyxiHistoryStartTime(timeType, selectedDate) {
  if (timeType === 2) return selectedDate.slice(0, 7);
  if (timeType === 3) return selectedDate.slice(0, 4);
  return selectedDate;
}

export function bucketKeys({ start, end, bucket }) {
  const keys = [];
  if (bucket === 'month') {
    const cursor = new Date(`${start}T00:00:00.000Z`);
    const limit = new Date(`${end}T00:00:00.000Z`);
    while (cursor < limit) {
      keys.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return keys;
  }
  for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) keys.push(cursor);
  return keys;
}

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function aggregateHistory(rows, { period, selectedDate, kind, localDate }) {
  const range = periodRange(period, selectedDate);
  const fields = fieldsByKind[kind];
  const grouped = new Map();
  for (const row of rows) {
    const date = localDate(row);
    if (!date || date < range.start || date >= range.end) continue;
    const key = range.bucket === 'month' ? date.slice(0, 7) : date;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const buckets = bucketKeys(range).map(key => {
    const entries = grouped.get(key) ?? [];
    const values = {};
    let partial = false;
    for (const field of fields) {
      const present = entries.map(row => numeric(row[field])).filter(value => value !== null);
      if (!present.length) values[field] = null;
      else {
        values[field] = kind === 'power'
          ? present.reduce((sum, value) => sum + value, 0) / present.length
          : present.reduce((sum, value) => sum + value, 0);
        if (present.length !== entries.length) partial = true;
      }
    }
    return {
      interval_start: range.bucket === 'month' ? `${key}-01T00:00:00.000Z` : `${key}T00:00:00.000Z`,
      ...values,
      coverage: entries.length ? (partial ? 'partial' : 'available') : 'none',
      sample_count: entries.length,
    };
  });
  return { period, start: range.start, end: range.end, bucket: range.bucket, buckets };
}
