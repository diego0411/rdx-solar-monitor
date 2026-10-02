import { supabase } from '../config/supabase.js';

const pageSize = 1000;

const requestSelect = `id, code, requested_by, plant_id, maintenance_visit_id,
  reason, priority, status, destination, destination_client_id,
  required_at, observations, created_at, updated_at`;
const lineSelect = `id, request_id, product_id, requested_quantity::text,
  prepared_quantity::text, delivered_quantity::text, observations,
  created_at, updated_at`;
const requestItemSelect = `id, request_line_id, inventory_item_id, prepared_by,
  prepared_at, delivered_at, released_at`;
const eventSelect = `id, request_id, event_type, actor_id, metadata,
  idempotency_key, created_at`;
const serialSelect = `id, product_id, serial_number, status, plant_id,
  client_id, device_id, created_at`;

function databaseError(error, fallback) {
  const wrapped = new Error(fallback);
  wrapped.dbCode = error?.code ?? null;
  wrapped.dbMessage = error?.message ?? null;
  return wrapped;
}

function rpcResult(data) {
  return Array.isArray(data) ? data[0] ?? null : data;
}

// Listado paginado ordenado por created_at DESC (contrato del módulo).
async function collectRequestsDesc(buildQuery, fallback) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery()
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw databaseError(error, fallback);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
}

export async function listMaterialRequests({
  status = null,
  priority = null,
  reason = null,
  plantId = null,
  dateFrom = null,
  dateTo = null,
  requestedBy = null,
} = {}) {
  return collectRequestsDesc(() => {
    let query = supabase.from('material_requests').select(requestSelect);
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (reason) query = query.eq('reason', reason);
    if (plantId) query = query.eq('plant_id', plantId);
    if (requestedBy) query = query.eq('requested_by', requestedBy);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);
    return query;
  }, 'No se pudieron consultar las solicitudes de materiales');
}

export async function getMaterialRequestById(id) {
  const { data, error } = await supabase.from('material_requests')
    .select(requestSelect).eq('id', id).maybeSingle();
  if (error) throw databaseError(error, 'No se pudo consultar la solicitud de materiales');
  return data;
}

export async function listRequestLines(requestId) {
  const { data, error } = await supabase.from('material_request_lines')
    .select(lineSelect).eq('request_id', requestId)
    .order('created_at', { ascending: true }).order('id', { ascending: true });
  if (error) throw databaseError(error, 'No se pudieron consultar las líneas de la solicitud');
  return data ?? [];
}

export async function listRequestLinesByRequestIds(requestIds) {
  if (!requestIds || requestIds.length === 0) return [];
  const rows = [];
  for (let offset = 0; offset < requestIds.length; offset += pageSize) {
    const chunk = requestIds.slice(offset, offset + pageSize);
    const { data, error } = await supabase.from('material_request_lines')
      .select('request_id, product_id, requested_quantity::text')
      .in('request_id', chunk);
    if (error) throw databaseError(error, 'No se pudieron consultar las líneas de la solicitud');
    rows.push(...(data ?? []));
  }
  return rows;
}

export async function getRequestLine(requestId, lineId) {
  const { data, error } = await supabase.from('material_request_lines')
    .select(lineSelect).eq('id', lineId).eq('request_id', requestId).maybeSingle();
  if (error) throw databaseError(error, 'No se pudo consultar la línea de la solicitud');
  return data;
}

export async function listRequestItems(lineIds) {
  if (!lineIds || lineIds.length === 0) return [];
  const rows = [];
  for (let offset = 0; offset < lineIds.length; offset += pageSize) {
    const chunk = lineIds.slice(offset, offset + pageSize);
    const { data, error } = await supabase.from('material_request_items')
      .select(requestItemSelect).in('request_line_id', chunk)
      .order('prepared_at', { ascending: true }).order('id', { ascending: true });
    if (error) throw databaseError(error, 'No se pudieron consultar los seriales preparados');
    rows.push(...(data ?? []));
  }
  return rows;
}

export async function listRequestEvents(requestId) {
  const { data, error } = await supabase.from('material_request_events')
    .select(eventSelect).eq('request_id', requestId)
    .order('created_at', { ascending: true }).order('id', { ascending: true });
  if (error) throw databaseError(error, 'No se pudo consultar el historial de la solicitud');
  return data ?? [];
}

// Clientes comerciales activos para el selector de destino.
// Solo lectura de catálogo: no se usa para autorización.
export async function listDestinationClients() {
  const { data, error } = await supabase.from('clients')
    .select('id, name, phone, email')
    .eq('active', true)
    .eq('is_commercial', true)
    .order('name', { ascending: true });
  if (error) throw databaseError(error, 'No se pudieron consultar los clientes destino');
  return data ?? [];
}

export async function getDestinationClientById(id) {
  const { data, error } = await supabase.from('clients')
    .select('id, name, active, is_commercial').eq('id', id).maybeSingle();
  if (error) throw databaseError(error, 'No se pudo consultar el cliente destino');
  return data;
}

export async function listDestinationClientsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const filtered = [...new Set(ids.filter(Boolean))];
  if (filtered.length === 0) return [];
  const { data, error } = await supabase.from('clients')
    .select('id, name').in('id', filtered);
  if (error) throw databaseError(error, 'No se pudieron consultar los clientes destino');
  return data ?? [];
}

export async function listRequesterProfiles(ids) {
  if (!ids || ids.length === 0) return [];
  const { data, error } = await supabase.from('user_profiles')
    .select('id, display_name').in('id', [...new Set(ids)]);
  if (error) throw databaseError(error, 'No se pudieron consultar los solicitantes');
  return data ?? [];
}

export async function listPlantsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const filtered = [...new Set(ids.filter(Boolean))];
  if (filtered.length === 0) return [];
  const { data, error } = await supabase.from('plants')
    .select('id, name').in('id', filtered);
  if (error) throw databaseError(error, 'No se pudieron consultar las plantas');
  return data ?? [];
}

export async function listInventoryItemsByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += pageSize) {
    const chunk = [...new Set(ids)].slice(offset, offset + pageSize);
    if (chunk.length === 0) break;
    const { data, error } = await supabase.from('inventory_items')
      .select(serialSelect).in('id', chunk);
    if (error) throw databaseError(error, 'No se pudieron consultar las unidades de inventario');
    rows.push(...(data ?? []));
  }
  return rows;
}

// Ids con reserva activa (preparados, ni entregados ni liberados).
export async function listActiveReservedItemIds() {
  const ids = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('material_request_items')
      .select('inventory_item_id').is('delivered_at', null).is('released_at', null)
      .order('inventory_item_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw databaseError(error, 'No se pudieron consultar las reservas activas');
    for (const row of data ?? []) ids.push(row.inventory_item_id);
    if ((data?.length ?? 0) < pageSize) return ids;
  }
  return ids;
}

// Seriales available de un producto, excluyendo reservas activas en
// material_request_items (delivered_at y released_at NULL).
export async function listAvailableSerials(productId) {
  const items = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('inventory_items')
      .select(serialSelect).eq('product_id', productId).eq('status', 'available')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw databaseError(error, 'No se pudieron consultar los seriales disponibles');
    items.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  const ids = items.map(item => item.id);
  const reserved = new Set();
  for (let offset = 0; offset < ids.length; offset += pageSize) {
    const chunk = ids.slice(offset, offset + pageSize);
    if (chunk.length === 0) break;
    const { data, error } = await supabase.from('material_request_items')
      .select('inventory_item_id').in('inventory_item_id', chunk)
      .is('delivered_at', null).is('released_at', null);
    if (error) throw databaseError(error, 'No se pudieron consultar las reservas activas');
    for (const row of data ?? []) reserved.add(row.inventory_item_id);
  }
  return items.filter(item => !reserved.has(item.id));
}

export async function rpcMaterialRequestCreate({
  actorId, reason, lines, priority, plantId, maintenanceVisitId,
  destination, requiredAt, observations, destinationClientId,
}) {
  const { data, error } = await supabase.rpc('material_request_create', {
    p_actor_id: actorId,
    p_reason: reason,
    p_lines: lines,
    p_priority: priority,
    p_plant_id: plantId,
    p_maintenance_visit_id: maintenanceVisitId,
    p_destination: destination,
    p_required_at: requiredAt,
    p_observations: observations,
    p_destination_client_id: destinationClientId,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo crear la solicitud de materiales');
  return result;
}

export async function rpcMaterialRequestTransition({ requestId, targetStatus, actorId, idempotencyKey }) {
  const { data, error } = await supabase.rpc('material_request_transition', {
    p_request_id: requestId,
    p_target_status: targetStatus,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo actualizar la solicitud de materiales');
  return result;
}

export async function rpcPrepareSerializedItem({
  requestId, lineId, inventoryItemId, actorId, observations,
}) {
  const { data, error } = await supabase.rpc('material_request_prepare_serialized_item', {
    p_request_id: requestId,
    p_request_line_id: lineId,
    p_inventory_item_id: inventoryItemId,
    p_actor_id: actorId,
    p_observations: observations,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo preparar el serial');
  return result;
}

export async function rpcReleaseSerializedItem({
  requestId, lineId, inventoryItemId, actorId, observations,
}) {
  const { data, error } = await supabase.rpc('material_request_release_serialized_item', {
    p_request_id: requestId,
    p_request_line_id: lineId,
    p_inventory_item_id: inventoryItemId,
    p_actor_id: actorId,
    p_observations: observations,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo liberar el serial');
  return result;
}

export async function rpcSetPreparedQuantity({
  requestId, lineId, preparedQuantity, actorId, observations,
}) {
  const { data, error } = await supabase.rpc('material_request_set_prepared_quantity', {
    p_request_id: requestId,
    p_request_line_id: lineId,
    p_prepared_quantity: preparedQuantity,
    p_actor_id: actorId,
    p_observations: observations,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo actualizar la cantidad preparada');
  return result;
}

export async function rpcCancelMaterialRequest({ requestId, actorId, idempotencyKey }) {
  const { data, error } = await supabase.rpc('material_request_cancel', {
    p_request_id: requestId,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo cancelar la solicitud de materiales');
  return result;
}

export async function rpcDeliverMaterialRequest({
  requestId, actorId, deliveries, idempotencyKey,
}) {
  const { data, error } = await supabase.rpc('material_request_deliver', {
    p_request_id: requestId,
    p_actor_id: actorId,
    p_deliveries: deliveries,
    p_idempotency_key: idempotencyKey,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo entregar la solicitud de materiales');
  return result;
}
