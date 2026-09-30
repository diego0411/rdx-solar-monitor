import { apiFetch } from './api.js';

export function listClients(options = {}) {
  const query = options.includePlantIds ? '?include=plant_ids' : '';
  return apiFetch(`/clients${query}`, { signal: options.signal });
}
