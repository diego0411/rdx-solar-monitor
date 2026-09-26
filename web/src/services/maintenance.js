import { apiFetch } from './api.js';

export function listMaintenanceVisits(params = {}, options = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, value);
    }
  }
  const query = search.size ? `?${search.toString()}` : '';
  return apiFetch(`/maintenance${query}`, { signal: options.signal });
}

export function getMaintenanceVisit(id, options = {}) {
  return apiFetch(`/maintenance/${encodeURIComponent(id)}`, { signal: options.signal });
}

export function createMaintenanceVisit(payload, options = {}) {
  return apiFetch('/maintenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

export function updateMaintenanceVisit(id, payload, options = {}) {
  return apiFetch(`/maintenance/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

export function updateMaintenanceStatus(id, status, options = {}) {
  return apiFetch(`/maintenance/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal: options.signal,
  });
}

export function createMaintenanceActivity(visitId, payload, options = {}) {
  return apiFetch(`/maintenance/${encodeURIComponent(visitId)}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

export function updateMaintenanceActivity(visitId, activityId, payload, options = {}) {
  return apiFetch(`/maintenance/${encodeURIComponent(visitId)}/activities/${encodeURIComponent(activityId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

export function deleteMaintenanceActivity(visitId, activityId, options = {}) {
  return apiFetch(`/maintenance/${encodeURIComponent(visitId)}/activities/${encodeURIComponent(activityId)}`, {
    method: 'DELETE',
    signal: options.signal,
  });
}
