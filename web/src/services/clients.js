import { apiFetch } from './api.js';

export function listClients(options = {}) {
  return apiFetch('/clients', { signal: options.signal });
}
