import { apiFetch } from './api.js';

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  return search.size ? `?${search.toString()}` : '';
}

function json(method, payload, signal, idempotencyKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return { method, headers, body: JSON.stringify(payload), signal };
}

function keyedPost(payload, signal, idempotencyKey) {
  return json('POST', payload, signal, idempotencyKey);
}

export function listRequests(params = {}, options = {}) {
  return apiFetch(`/operations/requests${query(params)}`, { signal: options.signal });
}

export function listProducts(options = {}) {
  return apiFetch('/operations/products', { signal: options.signal });
}

export function listClients(options = {}) {
  return apiFetch('/operations/clients', { signal: options.signal });
}

export function getRequest(id, options = {}) {
  return apiFetch(`/operations/requests/${encodeURIComponent(id)}`, { signal: options.signal });
}

export function createRequest(payload, options = {}) {
  return apiFetch('/operations/requests', json('POST', payload, options.signal));
}

export function transitionRequest(id, targetStatus, idempotencyKey, options = {}) {
  return apiFetch(
    `/operations/requests/${encodeURIComponent(id)}/transition`,
    keyedPost({ target_status: targetStatus }, options.signal, idempotencyKey),
  );
}

export function prepareSerializedItem(requestId, lineId, payload, options = {}) {
  return apiFetch(
    `/operations/requests/${encodeURIComponent(requestId)}/lines/${encodeURIComponent(lineId)}/serials`,
    json('POST', payload, options.signal),
  );
}

export function releaseSerializedItem(requestId, lineId, itemId, payload = null, options = {}) {
  const init = { method: 'DELETE', signal: options.signal };
  if (payload !== null && payload !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(payload);
  }
  return apiFetch(
    `/operations/requests/${encodeURIComponent(requestId)}/lines/${encodeURIComponent(lineId)}/serials/${encodeURIComponent(itemId)}`,
    init,
  );
}

export function setPreparedQuantity(requestId, lineId, payload, options = {}) {
  return apiFetch(
    `/operations/requests/${encodeURIComponent(requestId)}/lines/${encodeURIComponent(lineId)}/prepared-quantity`,
    json('PATCH', payload, options.signal),
  );
}

export function cancelRequest(id, idempotencyKey, options = {}) {
  return apiFetch(
    `/operations/requests/${encodeURIComponent(id)}/cancel`,
    keyedPost({}, options.signal, idempotencyKey),
  );
}

export function deliverRequest(id, deliveries, idempotencyKey, options = {}) {
  return apiFetch(
    `/operations/requests/${encodeURIComponent(id)}/deliver`,
    keyedPost({ deliveries }, options.signal, idempotencyKey),
  );
}

export function listAvailableItems(requestId, lineId, options = {}) {
  return apiFetch(
    `/operations/requests/${encodeURIComponent(requestId)}/lines/${encodeURIComponent(lineId)}/available-items`,
    { signal: options.signal },
  );
}
