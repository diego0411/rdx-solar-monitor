import {
  getInventoryOperationById,
  listInventoryOperationLines,
  listInventoryOperationLinesByOperationIds,
  listInventoryOperations,
  listOperationProductsByIds,
  rpcInventoryOperationCancel,
  rpcInventoryOperationConfirm,
  rpcInventoryOperationCreate,
} from '../repositories/inventory.operations.repository.js';
import { resolveIdempotencyKey } from './operations.service.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operationTypes = ['IN', 'ADJUST_IN', 'ADJUST_OUT'];
const operationStatuses = ['draft', 'confirmed', 'cancelled'];
const writerRoles = ['rdx_admin', 'client_admin'];

function codedError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateUuid(value, field) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw codedError(400, `${field} inválido`);
  }
  return value.toLowerCase();
}

function ensureObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw codedError(400, 'Payload inválido');
  }
  return body;
}

function allowFields(body, allowed) {
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) throw codedError(400, `Campo no permitido: ${field}`);
  }
}

function cleanText(value, field, { required = false, max = 4000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw codedError(400, `${field} requerido`);
    return null;
  }
  if (typeof value !== 'string') throw codedError(400, `${field} inválido`);
  const clean = value.trim();
  if ((required && clean === '') || clean.length > max) {
    throw codedError(400, `${field} inválido`);
  }
  return clean === '' ? null : clean;
}

function cleanDate(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw codedError(400, `${field} inválido`);
  }
  return value;
}

// Cantidad positiva superficial: acepta número finito o cadena decimal.
// Postgres es la autoridad (tracking mode, enteros de serialized, NaN...).
function cleanPositiveQuantity(value, field) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) throw codedError(400, `${field} inválida`);
    return value;
  }
  if (typeof value === 'string') {
    const clean = value.trim();
    if (!/^[+]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(clean)) {
      throw codedError(400, `${field} inválida`);
    }
    const numeric = Number(clean);
    if (!Number.isFinite(numeric) || numeric <= 0) throw codedError(400, `${field} inválida`);
    return clean;
  }
  throw codedError(400, `${field} inválida`);
}

// Escritura de operaciones: rdx_admin o client_admin (el módulo inventory
// ya lo exige requireModuleAccess en el router y el RPC lo revalida).
// client_user nunca escribe, aunque tenga el módulo.
function requireOperationWriter(profile) {
  if (!writerRoles.includes(profile?.role)) throw codedError(403, 'Acceso denegado');
}

function cleanOperationLine(line, index) {
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    throw codedError(400, `lines[${index}] inválida`);
  }
  allowFields(line, ['product_id', 'quantity', 'serial_numbers', 'notes']);
  const clean = {
    product_id: validateUuid(line.product_id, `lines[${index}].product_id`),
    quantity: cleanPositiveQuantity(line.quantity, `lines[${index}].quantity`),
  };
  if (line.serial_numbers !== undefined && line.serial_numbers !== null) {
    if (!Array.isArray(line.serial_numbers)) {
      throw codedError(400, `lines[${index}].serial_numbers inválidos`);
    }
    clean.serial_numbers = line.serial_numbers;
  }
  const notes = cleanText(line.notes, `lines[${index}].notes`, { max: 4000 });
  if (notes !== null) clean.notes = notes;
  return clean;
}

function attachProducts(lines, productsById) {
  return lines.map(line => ({
    ...line,
    product: productsById.get(line.product_id) ?? null,
  }));
}

async function withProducts(lines) {
  const ids = [...new Set(lines.map(line => line.product_id).filter(Boolean))];
  const products = await listOperationProductsByIds(ids);
  return attachProducts(lines, new Map(products.map(product => [product.id, product])));
}

export async function listInventoryOperationDocs(profile, filters = {}) {
  const clean = {};
  if (filters.operationType !== undefined) {
    if (!operationTypes.includes(filters.operationType)) {
      throw codedError(400, 'operationType inválido');
    }
    clean.operationType = filters.operationType;
  }
  if (filters.status !== undefined) {
    if (!operationStatuses.includes(filters.status)) throw codedError(400, 'status inválido');
    clean.status = filters.status;
  }
  if (filters.dateFrom !== undefined) clean.dateFrom = cleanDate(filters.dateFrom, 'dateFrom');
  if (filters.dateTo !== undefined) clean.dateTo = cleanDate(filters.dateTo, 'dateTo');
  let operations;
  try {
    operations = await listInventoryOperations(clean);
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
  if (operations.length === 0) return [];
  let lines = [];
  try {
    lines = await listInventoryOperationLinesByOperationIds(operations.map(op => op.id));
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
  const linesByOperation = new Map(operations.map(op => [op.id, []]));
  for (const line of lines) {
    if (linesByOperation.has(line.operation_id)) linesByOperation.get(line.operation_id).push(line);
  }
  let enriched = [];
  try {
    enriched = await withProducts(lines);
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
  const enrichedById = new Map(enriched.map(line => [line.id, line]));
  return operations.map(operation => ({
    ...operation,
    line_count: (linesByOperation.get(operation.id) ?? []).length,
    lines: (linesByOperation.get(operation.id) ?? []).map(line => enrichedById.get(line.id) ?? line),
  }));
}

export async function getInventoryOperationDoc(profile, id) {
  const operationId = validateUuid(id, 'id');
  let operation;
  try {
    operation = await getInventoryOperationById(operationId);
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
  if (!operation) throw codedError(404, 'Operación no encontrada');
  let lines;
  try {
    lines = await listInventoryOperationLines(operationId);
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
  let enriched;
  try {
    enriched = await withProducts(lines);
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
  return { operation, lines: enriched };
}

export async function createInventoryOperationDoc(profile, body, idempotencyKey) {
  requireOperationWriter(profile);
  const payload = ensureObject(body);
  allowFields(payload, ['operation_type', 'operation_date', 'reference', 'notes', 'lines',
    'idempotency_key']);
  if (!operationTypes.includes(payload.operation_type)) {
    throw codedError(400, 'operation_type inválido');
  }
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw codedError(400, 'lines inválidas');
  }
  const lines = payload.lines.map((line, index) => cleanOperationLine(line, index));
  const key = resolveIdempotencyKey(idempotencyKey);
  try {
    // Postgres es la autoridad: tracking mode, seriales, duplicados,
    // tipos permitidos e integridad de líneas. Node no los revalida.
    return await rpcInventoryOperationCreate({
      actorId: profile.id,
      operationType: payload.operation_type,
      lines,
      operationDate: cleanDate(payload.operation_date, 'operation_date'),
      reference: cleanText(payload.reference, 'reference', { max: 200 }),
      notes: cleanText(payload.notes, 'notes', { max: 4000 }),
      idempotencyKey: key,
    });
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
}

export async function confirmInventoryOperationDoc(profile, id, idempotencyKey) {
  requireOperationWriter(profile);
  const operationId = validateUuid(id, 'id');
  const key = resolveIdempotencyKey(idempotencyKey);
  try {
    // Atomicidad total dentro del RPC: Node no inserta movements,
    // no toca inventory_items ni calcula stock.
    return await rpcInventoryOperationConfirm({
      operationId,
      actorId: profile.id,
      idempotencyKey: key,
    });
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
}

export async function cancelInventoryOperationDoc(profile, id, idempotencyKey) {
  requireOperationWriter(profile);
  const operationId = validateUuid(id, 'id');
  const key = resolveIdempotencyKey(idempotencyKey);
  try {
    // Sin UPDATE directo de status: solo el RPC cancela.
    return await rpcInventoryOperationCancel({
      operationId,
      actorId: profile.id,
      idempotencyKey: key,
    });
  } catch (error) {
    throw mapInventoryOperationError(error);
  }
}

export function mapInventoryOperationError(error) {
  if (Number.isSafeInteger(error?.statusCode)) return error;
  const message = String(error?.dbMessage ?? error?.message ?? '');
  const mappings = {
    ACCESS_DENIED: [403, 'Acceso denegado'],
    OPERATION_NOT_FOUND: [404, 'Operación no encontrada'],
    PRODUCT_NOT_FOUND: [404, 'Producto no encontrado'],
    INVALID_OPERATION_TYPE: [400, 'Tipo de operación inválido'],
    INVALID_OPERATION_LINES: [400, 'Líneas de operación inválidas'],
    INVALID_TRACKING_MODE: [400, 'Modo de seguimiento incompatible con la operación'],
    INVALID_SERIAL_NUMBERS: [400, 'Seriales inválidos'],
    INVALID_SERIAL: [400, 'Serial inválido'],
    INVALID_QUANTITY: [400, 'Cantidad inválida'],
    INVALID_IDEMPOTENCY_KEY: [400, 'Idempotency-Key inválido'],
    INACTIVE_PRODUCT: [409, 'El producto está inactivo'],
    INVALID_STATUS: [409, 'Estado de operación no permitido'],
    ALREADY_CONFIRMED: [409, 'La operación ya está confirmada'],
    ALREADY_CANCELLED: [409, 'La operación ya está cancelada'],
    INSUFFICIENT_STOCK: [409, 'Stock insuficiente'],
    SERIAL_ALREADY_EXISTS: [409, 'El serial ya está registrado'],
    DUPLICATE_OPERATION_PRODUCT: [409, 'Producto duplicado en la operación'],
    DUPLICATE_SERIAL_NUMBER: [409, 'Serial duplicado en la operación'],
    IDEMPOTENCY_CONFLICT: [409, 'Conflicto de idempotencia'],
    IMMUTABLE_OPERATION: [409, 'La operación ya no es modificable'],
  };
  for (const [token, [status, publicMessage]] of Object.entries(mappings)) {
    if (message.includes(token)) return codedError(status, publicMessage);
  }
  if (error?.dbCode === '23505' || /duplicate|unique/i.test(message)) {
    return codedError(409, 'Conflicto de duplicado');
  }
  return codedError(503, 'Error interno de inventario');
}
