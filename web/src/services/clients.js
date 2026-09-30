import { apiFetch } from './api.js';

export function listClients(options = {}) {
  const params = new URLSearchParams();
  if (options.includePlantIds) params.set('include', 'plant_ids');
  if (options.status) params.set('status', options.status);
  const query = params.size ? `?${params.toString()}` : '';
  return apiFetch(`/clients${query}`, { signal: options.signal });
}

function json(method, payload, signal) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  };
}

export function createClient(payload, options = {}) {
  return apiFetch('/clients', json('POST', payload, options.signal));
}

export function updateClient(id, payload, options = {}) {
  return apiFetch(`/clients/${encodeURIComponent(id)}`, json('PATCH', payload, options.signal));
}

export function setClientStatus(id, active, options = {}) {
  return apiFetch(`/clients/${encodeURIComponent(id)}/status`,
    json('PATCH', { active }, options.signal));
}

export function assignClientPlant(id, plantId, options = {}) {
  return apiFetch(`/clients/${encodeURIComponent(id)}/plants/${encodeURIComponent(plantId)}`, {
    method: 'PUT', signal: options.signal,
  });
}
