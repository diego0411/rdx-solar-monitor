import { supabase } from '../config/supabase.js';

const pageSize = 1000;
const productSelect = `id, name, category, manufacturer, model, unit, tracking_mode,
  reorder_level::text, active, created_at, updated_at`;
const movementSelect = `id, product_id, item_id, movement_type, quantity::text,
  from_status, to_status, client_id, plant_id, device_id, notes, created_by, created_at`;

function databaseError(error, fallback) {
  const wrapped = new Error(fallback);
  wrapped.dbCode = error?.code ?? null;
  wrapped.dbMessage = error?.message ?? null;
  return wrapped;
}

async function collectPages(buildQuery, fallback) {
  const rows = [];
  let cursor = null;
  for (;;) {
    let query = buildQuery().order('id', { ascending: true }).limit(pageSize);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw databaseError(error, fallback);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
    cursor = data[data.length - 1].id;
  }
}

export async function listInventoryProducts({ category = null, trackingMode = null, active = null } = {}) {
  const products = await collectPages(() => {
    let query = supabase.from('inventory_products').select(productSelect);
    if (category) query = query.eq('category', category);
    if (trackingMode) query = query.eq('tracking_mode', trackingMode);
    if (active !== null) query = query.eq('active', active);
    return query;
  }, 'No se pudieron consultar los productos de inventario');
  return products.sort((left, right) => left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id));
}

export async function getInventoryProductById(id) {
  const { data, error } = await supabase.from('inventory_products')
    .select(productSelect).eq('id', id).maybeSingle();
  if (error) throw databaseError(error, 'No se pudo consultar el producto de inventario');
  return data;
}

export async function insertInventoryProduct(values) {
  const { data, error } = await supabase.from('inventory_products')
    .insert(values).select(productSelect).single();
  if (error || !data) {
    throw databaseError(error, 'No se pudo crear el producto de inventario');
  }
  return data;
}

export async function updateInventoryProduct(id, values) {
  const { data, error } = await supabase.from('inventory_products')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id).select(productSelect).maybeSingle();
  if (error) throw databaseError(error, 'No se pudo actualizar el producto de inventario');
  return data;
}

function applyScope(query, scope) {
  if (!scope) return query;
  if (!scope.plantIds || scope.plantIds.size === 0) return null;
  return query.in('plant_id', [...scope.plantIds]);
}

export async function listInventoryItems({
  productId = null,
  status = null,
  clientId = null,
  plantId = null,
  search = null,
  scope = null,
} = {}) {
  if (scope && (!scope.plantIds || scope.plantIds.size === 0)) return [];
  const items = await collectPages(() => {
    let query = supabase.from('inventory_items').select('*');
    query = applyScope(query, scope);
    if (productId) query = query.eq('product_id', productId);
    if (status) query = query.eq('status', status);
    if (clientId) query = query.eq('client_id', clientId);
    if (plantId) query = query.eq('plant_id', plantId);
    if (search) query = query.ilike('serial_number', `%${search}%`);
    return query;
  }, 'No se pudieron consultar las unidades de inventario');
  return items.sort((left, right) => right.created_at.localeCompare(left.created_at)
    || left.id.localeCompare(right.id));
}

export async function listInventoryMovements({
  productId = null,
  itemId = null,
  movementType = null,
  clientId = null,
  plantId = null,
  dateFrom = null,
  dateTo = null,
  scope = null,
} = {}) {
  if (scope && (!scope.plantIds || scope.plantIds.size === 0)) return [];
  const movements = await collectPages(() => {
    let query = supabase.from('inventory_movements').select(movementSelect);
    query = applyScope(query, scope);
    if (productId) query = query.eq('product_id', productId);
    if (itemId) query = query.eq('item_id', itemId);
    if (movementType) query = query.eq('movement_type', movementType);
    if (clientId) query = query.eq('client_id', clientId);
    if (plantId) query = query.eq('plant_id', plantId);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo);
    return query;
  }, 'No se pudieron consultar los movimientos de inventario');
  return movements.sort((left, right) => right.created_at.localeCompare(left.created_at)
    || left.id.localeCompare(right.id));
}

function rpcResult(data) {
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function createSerializedInventoryItem({ productId, serialNumber, notes, createdBy }) {
  const { data, error } = await supabase.rpc('inventory_create_serialized_item', {
    p_product_id: productId,
    p_serial_number: serialNumber,
    p_notes: notes,
    p_created_by: createdBy,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo registrar la unidad de inventario');
  return result;
}

export async function transitionSerializedInventoryItem({
  itemId, movementType, clientId, plantId, deviceId, notes, createdBy,
}) {
  const { data, error } = await supabase.rpc('inventory_transition_serialized_item', {
    p_item_id: itemId,
    p_movement_type: movementType,
    p_client_id: clientId,
    p_plant_id: plantId,
    p_device_id: deviceId,
    p_notes: notes,
    p_created_by: createdBy,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo realizar la transición de inventario');
  return result;
}

export async function recordQuantityInventoryMovement({
  productId, movementType, quantity, sourceStatus, clientId, plantId, notes, createdBy,
}) {
  const { data, error } = await supabase.rpc('inventory_record_quantity_movement', {
    p_product_id: productId,
    p_movement_type: movementType,
    p_quantity: quantity,
    p_source_status: sourceStatus,
    p_client_id: clientId,
    p_plant_id: plantId,
    p_notes: notes,
    p_created_by: createdBy,
  });
  const result = rpcResult(data);
  if (error || !result) throw databaseError(error, 'No se pudo registrar el movimiento de inventario');
  return result;
}
