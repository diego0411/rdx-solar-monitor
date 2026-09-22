import { apiFetch } from './api.js';

export function listUsers(options = {}) {
  return apiFetch('/users', { signal: options.signal });
}

export function createUser(payload, options = {}) {
  return apiFetch('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

export function updateUser(id, payload, options = {}) {
  return apiFetch(`/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
}

export function setUserStatus(id, active, options = {}) {
  return apiFetch(`/users/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
    signal: options.signal,
  });
}
