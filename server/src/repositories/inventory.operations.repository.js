import { supabase } from '../config/supabase.js';

const pageSize = 1000;

const operationSelect = `id, operation_type, operation_date, reference, notes,
  status, created_by, confirmed_by, confirmed_at, cancelled_by, cancelled_at,
  created_at, updated_at`;
const operationLineSelect = `id, operation_id, product_id, quantity::text,
  serial_numbers, notes, line_order, created_at`;
const operationProductSelect = `id, name, category, tracking_mode, unit`;

function databaseError(error, fallback) {
  const wrapped = new Error(fallback);
  wrapped.dbCode = error?.code ?? null;
  wrapped.dbMessage = error?.message ?? null;
  return wrapped;
}

function rpcResult(data) {
  return Array.isArray(data) ? data[0] ?? null : data;
}

// Listado ordenado por fecha de operación y creación (contrato del módulo).
async function collectOperationsDesc(buildQuery, fallback) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery()
      .order('operation_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw databaseError(error, fallback);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
}

export async function listInventoryOperations({
  operationType = null,
  status = null,
  dateFrom = null,
  dateTo = null,
} = {}) {
  return collectOperationsDesc(() => {
    let query = supabase.from('inventory_operations').select(operationSelect);
    if (operationType) query = query.eq('operation_type', operationType);
    if (status) query = query.eq('status', status);
    if (dateFrom) query = query.gte('operation_date', dateFrom);
    if (dateTo) query = query.lte('operation_date', dateTo);
    return query;
  }, 'No se pudieron consultar las operaciones de inventario');
}

export async function getInventoryOperationById(id) {
  const { data, error } = await supabase.from('inventory_operations')
    .select(operationSelect).eq('id', id).maybeSingle();
  if (error) throw databaseError(error, 'No se pudo consultar la operación de inventario');
  return data;
}

export async function listInventoryOperationLines(operationId) {
  const { data, error } = await supabase.from('inventory_operation_lines')
    .select(operationLineSelect).eq('operation_id', operationId)
    .order('line_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw databaseError(error, 'No se pudieron consultar las líneas de la operación');
  return data ?? [];
}

export async function listInventoryOperationLinesByOperationIds(operationIds) {
  if (!Array.isArray(operationIds) || operationIds.length === 0) return [];
  const { data, error } = await supabase.from('inventory_operation_lines')
    .select(operationLineSelect).in('operation_id', operationIds)
    .order('line_order', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw databaseError(error, 'No se pudieron consultar las líneas de las operaciones');
  return data ?? [];
}

export async function listOperationProductsByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const { data, error } = await supabase.from('inventory_products')
    .select(operationProductSelect).in('id', ids);
  if (error) throw databaseError(error, 'No se pudieron consultar los productos de la operación');
  return data ?? [];
}

export async function rpcInventoryOperationCreate({
  actorId,
  operationType,
  lines,
  operationDate = null,
  reference = null,
  notes = null,
  idempotencyKey = null,
}) {
  const args = {
    p_actor_id: actorId,
    p_operation_type: operationType,
    p_lines: lines,
    p_reference: reference,
    p_notes: notes,
    p_idempotency_key: idempotencyKey,
  };
  // operation_date omitido => DEFAULT CURRENT_DATE del RPC.
  if (operationDate !== null && operationDate !== undefined) {
    args.p_operation_date = operationDate;
  }
  const { data, error } = await supabase.rpc('inventory_operation_create', args);
  const result = rpcResult(data);
  if (error || !result) {
    throw databaseError(error, 'No se pudo crear la operación de inventario');
  }
  return result;
}

export async function rpcInventoryOperationConfirm({ operationId, actorId, idempotencyKey }) {
  const { data, error } = await supabase.rpc('inventory_operation_confirm', {
    p_operation_id: operationId,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
  });
  const result = rpcResult(data);
  if (error || !result) {
    throw databaseError(error, 'No se pudo confirmar la operación de inventario');
  }
  return result;
}

export async function rpcInventoryOperationCancel({ operationId, actorId, idempotencyKey }) {
  const { data, error } = await supabase.rpc('inventory_operation_cancel', {
    p_operation_id: operationId,
    p_actor_id: actorId,
    p_idempotency_key: idempotencyKey,
  });
  const result = rpcResult(data);
  if (error || !result) {
    throw databaseError(error, 'No se pudo cancelar la operación de inventario');
  }
  return result;
}
