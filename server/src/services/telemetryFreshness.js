export const FRESH_MINUTES = 15;

export function telemetryFreshness(lastDataAt, now = Date.now()) {
  const timestamp = lastDataAt == null ? NaN : Date.parse(lastDataAt);
  if (!Number.isFinite(timestamp)) return { data_status: 'no_data', data_age_minutes: null };
  const age = (now - timestamp) / 60000;
  return {
    data_status: age >= 0 && age <= FRESH_MINUTES ? 'fresh' : 'stale',
    data_age_minutes: Number(Math.max(0, age).toFixed(2)),
  };
}
