import { apiFetch } from './api.js';

export function listAlarms(params = {}, options = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  }
  const query = search.size ? `?${search.toString()}` : '';
  return apiFetch(`/alarms${query}`, { signal: options.signal });
}

export function getAlarmSummary(options = {}) {
  return apiFetch('/alarms/summary', { signal: options.signal });
}

export function getAlarm(id, options = {}) {
  return apiFetch(`/alarms/${encodeURIComponent(id)}`, { signal: options.signal });
}
