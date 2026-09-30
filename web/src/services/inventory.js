import { apiFetch } from './api.js';

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  return search.size ? `?${search.toString()}` : '';
}

function json(method, payload, signal) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  };
}

export function listInventoryProducts(params = {}, options = {}) {
  return apiFetch(`/inventory/products${query(params)}`, { signal: options.signal });
}

export function getInventoryProduct(id, options = {}) {
  return apiFetch(`/inventory/products/${encodeURIComponent(id)}`, { signal: options.signal });
}

export function createInventoryProduct(payload, options = {}) {
  return apiFetch('/inventory/products', json('POST', payload, options.signal));
}

export function updateInventoryProduct(id, payload, options = {}) {
  return apiFetch(`/inventory/products/${encodeURIComponent(id)}`, json('PATCH', payload, options.signal));
}

export function listInventoryItems(productId, params = {}, options = {}) {
  return apiFetch(`/inventory/products/${encodeURIComponent(productId)}/items${query(params)}`, {
    signal: options.signal,
  });
}

export function createSerializedInventoryItem(productId, payload, options = {}) {
  return apiFetch(`/inventory/products/${encodeURIComponent(productId)}/items`,
    json('POST', payload, options.signal));
}

export function transitionSerializedInventoryItem(itemId, payload, options = {}) {
  return apiFetch(`/inventory/items/${encodeURIComponent(itemId)}/transition`,
    json('POST', payload, options.signal));
}

export function createQuantityInventoryMovement(productId, payload, options = {}) {
  return apiFetch(`/inventory/products/${encodeURIComponent(productId)}/movements`,
    json('POST', payload, options.signal));
}

export function listInventoryMovements(params = {}, options = {}) {
  return apiFetch(`/inventory/movements${query(params)}`, { signal: options.signal });
}
