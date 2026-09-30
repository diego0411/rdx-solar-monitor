import {
  createSerializedInventoryItem,
  getInventoryProductById,
  insertInventoryProduct,
  listInventoryItems,
  listInventoryMovements,
  listInventoryProducts,
  recordQuantityInventoryMovement,
  transitionSerializedInventoryItem,
  updateInventoryProduct,
} from '../repositories/inventory.repository.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = ['inverter', 'solar_panel', 'smart_meter', 'battery', 'datalogger',
  'protection', 'structure', 'cable', 'other'];
const trackingModes = ['serialized', 'quantity'];
const itemStatuses = ['available', 'assigned', 'installed', 'sold', 'written_off'];
const movementTypes = ['in', 'assign', 'install', 'sell', 'return', 'write_off',
  'adjust_in', 'adjust_out'];
const serializedTransitions = ['assign', 'install', 'return', 'sell', 'write_off'];
const sourceStatuses = ['available', 'assigned', 'installed'];
const summaryStatuses = ['available', 'assigned', 'installed', 'sold', 'written_off'];

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

function requireAdmin(profile) {
  if (profile?.role !== 'rdx_admin') throw codedError(403, 'Acceso denegado');
}

function parseDecimal(value) {
  const input = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof input !== 'string') return null;
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(input.trim());
  if (!match) return null;
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 131072) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  let digits = `${match[2]}${match[3] ?? ''}`.replace(/^0+(?=\d)/, '');
  let scale = (match[3]?.length ?? 0) - exponent;
  let units = BigInt(digits || '0') * sign;
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return { units, scale };
}

function addDecimal(left, right, direction = 1n) {
  const scale = Math.max(left.scale, right.scale);
  let units = left.units * 10n ** BigInt(scale - left.scale)
    + direction * right.units * 10n ** BigInt(scale - right.scale);
  let normalizedScale = scale;
  while (normalizedScale > 0 && units % 10n === 0n) {
    units /= 10n;
    normalizedScale -= 1;
  }
  return { units, scale: normalizedScale };
}

function decimalString(decimal) {
  const negative = decimal.units < 0n;
  let digits = (negative ? -decimal.units : decimal.units).toString();
  if (decimal.scale > 0) digits = digits.padStart(decimal.scale + 1, '0');
  const split = decimal.scale === 0 ? digits.length : digits.length - decimal.scale;
  const result = decimal.scale === 0
    ? digits
    : `${digits.slice(0, split)}.${digits.slice(split)}`.replace(/\.?0+$/, '');
  return `${negative ? '-' : ''}${result}`;
}

export function projectQuantityLedger(movements, { includeAvailable = true } = {}) {
  const balances = Object.fromEntries(summaryStatuses.map(status => [status, { units: 0n, scale: 0 }]));
  for (const movement of movements) {
    if (typeof movement.quantity !== 'string') {
      throw codedError(503, 'Ledger de inventario inconsistente');
    }
    const quantity = parseDecimal(movement.quantity);
    if (!quantity || quantity.units <= 0n) throw codedError(503, 'Ledger de inventario inconsistente');
    if (movement.from_status !== null && !summaryStatuses.includes(movement.from_status)) {
      throw codedError(503, 'Ledger de inventario inconsistente');
    }
    if (movement.to_status !== null && !summaryStatuses.includes(movement.to_status)) {
      throw codedError(503, 'Ledger de inventario inconsistente');
    }
    if (movement.from_status && (includeAvailable || movement.from_status !== 'available')) {
      balances[movement.from_status] = addDecimal(balances[movement.from_status], quantity, -1n);
    }
    if (movement.to_status && (includeAvailable || movement.to_status !== 'available')) {
      balances[movement.to_status] = addDecimal(balances[movement.to_status], quantity);
    }
  }
  if (!includeAvailable) balances.available = { units: 0n, scale: 0 };
  for (const status of summaryStatuses) {
    if (balances[status].units < 0n) throw codedError(503, 'Ledger de inventario inconsistente');
  }
  const physical = addDecimal(addDecimal(balances.available, balances.assigned), balances.installed);
  return {
    ...Object.fromEntries(summaryStatuses.map(status => [status, decimalString(balances[status])])),
    physical_stock: decimalString(physical),
  };
}

function serializedSummary(items, includeAvailable) {
  const counts = Object.fromEntries(summaryStatuses.map(status => [status, 0]));
  for (const item of items) {
    if (itemStatuses.includes(item.status) && (includeAvailable || item.status !== 'available')) {
      counts[item.status] += 1;
    }
  }
  if (!includeAvailable) counts.available = 0;
  return {
    ...Object.fromEntries(summaryStatuses.map(status => [status, String(counts[status])])),
    physical_stock: String(counts.available + counts.assigned + counts.installed),
  };
}

function inventoryScope(profile, scope) {
  return profile?.role === 'rdx_admin' ? null : {
    client_id: profile?.client_id ?? null,
    plantIds: scope?.plantIds ?? new Set(),
  };
}

function productSummary(product, items, movements, includeAvailable) {
  return product.tracking_mode === 'serialized'
    ? serializedSummary(items.filter(item => item.product_id === product.id), includeAvailable)
    : projectQuantityLedger(
      movements.filter(movement => movement.product_id === product.id),
      { includeAvailable },
    );
}

function cleanProductFilters(filters = {}) {
  const result = {};
  if (filters.category !== undefined) {
    if (!categories.includes(filters.category)) throw codedError(400, 'category inválido');
    result.category = filters.category;
  }
  if (filters.trackingMode !== undefined) {
    if (!trackingModes.includes(filters.trackingMode)) throw codedError(400, 'trackingMode inválido');
    result.trackingMode = filters.trackingMode;
  }
  if (filters.active !== undefined) {
    if (!['true', 'false'].includes(filters.active)) throw codedError(400, 'active inválido');
    result.active = filters.active === 'true';
  }
  if (filters.search !== undefined) result.search = cleanText(filters.search, 'search', { max: 120 });
  return result;
}

export async function getInventoryProducts(profile, scope, filters = {}) {
  const clean = cleanProductFilters(filters);
  let products = await listInventoryProducts(clean);
  if (clean.search) {
    const search = clean.search.toLocaleLowerCase();
    products = products.filter(product => [product.name, product.manufacturer, product.model]
      .some(value => value?.toLocaleLowerCase().includes(search)));
  }
  const scoped = inventoryScope(profile, scope);
  const [items, movements] = await Promise.all([
    listInventoryItems({ scope: scoped }),
    listInventoryMovements({ scope: scoped }),
  ]);
  if (scoped) {
    const visibleIds = new Set([
      ...items.map(item => item.product_id),
      ...movements.map(movement => movement.product_id),
    ]);
    products = products.filter(product => visibleIds.has(product.id));
  }
  return products.map(product => ({
    ...product,
    summary: productSummary(product, items, movements, !scoped),
  }));
}

export async function getInventoryProduct(profile, scope, id) {
  const productId = validateUuid(id, 'id');
  const product = await getInventoryProductById(productId);
  if (!product) throw codedError(404, 'Producto no encontrado');
  const scoped = inventoryScope(profile, scope);
  const [items, movements] = await Promise.all([
    listInventoryItems({ productId, scope: scoped }),
    listInventoryMovements({ productId, scope: scoped }),
  ]);
  if (scoped && items.length === 0 && movements.length === 0) {
    throw codedError(404, 'Producto no encontrado');
  }
  return { product, summary: productSummary(product, items, movements, !scoped) };
}

function productValues(body, patch = false) {
  ensureObject(body);
  const allowed = ['name', 'category', 'manufacturer', 'model', 'unit', 'tracking_mode',
    'reorder_level', ...(patch ? ['active'] : [])];
  allowFields(body, allowed);
  const values = {};
  if (!patch || body.name !== undefined) values.name = cleanText(body.name, 'name', { required: true, max: 200 });
  if (!patch || body.category !== undefined) {
    if (!categories.includes(body.category)) throw codedError(400, 'category inválido');
    values.category = body.category;
  }
  for (const field of ['manufacturer', 'model']) {
    if (body[field] !== undefined) values[field] = cleanText(body[field], field, { max: 200 });
  }
  if (!patch || body.unit !== undefined) values.unit = cleanText(body.unit, 'unit', { required: true, max: 40 });
  if (!patch || body.tracking_mode !== undefined) {
    if (!trackingModes.includes(body.tracking_mode)) throw codedError(400, 'tracking_mode inválido');
    values.tracking_mode = body.tracking_mode;
  }
  if (!patch || body.reorder_level !== undefined) {
    const level = body.reorder_level;
    const decimal = validDecimal(level, { allowZero: true });
    if (!decimal) {
      throw codedError(400, 'reorder_level inválido');
    }
    values.reorder_level = typeof level === 'string' ? level.trim() : level;
  }
  if (patch && body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw codedError(400, 'active inválido');
    values.active = body.active;
  }
  if (patch && Object.keys(values).length === 0) throw codedError(400, 'Nada que actualizar');
  return values;
}

export async function createInventoryProduct(profile, body) {
  requireAdmin(profile);
  try {
    return await insertInventoryProduct(productValues(body));
  } catch (error) {
    throw mapInventoryDatabaseError(error);
  }
}

export async function patchInventoryProduct(profile, id, body) {
  requireAdmin(profile);
  const productId = validateUuid(id, 'id');
  try {
    const product = await updateInventoryProduct(productId, productValues(body, true));
    if (!product) throw codedError(404, 'Producto no encontrado');
    return product;
  } catch (error) {
    throw mapInventoryDatabaseError(error);
  }
}

function cleanOptionalUuid(value, field) {
  return value === undefined || value === null ? null : validateUuid(value, field);
}

function cleanNotes(value) {
  return cleanText(value, 'notes', { max: 4000 });
}

export async function createInventoryItem(profile, productId, body) {
  requireAdmin(profile);
  const id = validateUuid(productId, 'id');
  ensureObject(body);
  allowFields(body, ['serial_number', 'notes']);
  const serialNumber = cleanText(body.serial_number, 'serial_number', { required: true, max: 300 });
  try {
    return await createSerializedInventoryItem({
      productId: id,
      serialNumber,
      notes: cleanNotes(body.notes),
      createdBy: profile.id,
    });
  } catch (error) {
    throw mapInventoryDatabaseError(error);
  }
}

export async function transitionInventoryItem(profile, itemId, body) {
  requireAdmin(profile);
  const id = validateUuid(itemId, 'id');
  ensureObject(body);
  allowFields(body, ['movement_type', 'client_id', 'plant_id', 'device_id', 'notes']);
  if (!serializedTransitions.includes(body.movement_type)) {
    throw codedError(400, 'movement_type inválido');
  }
  try {
    return await transitionSerializedInventoryItem({
      itemId: id,
      movementType: body.movement_type,
      clientId: cleanOptionalUuid(body.client_id, 'client_id'),
      plantId: cleanOptionalUuid(body.plant_id, 'plant_id'),
      deviceId: cleanOptionalUuid(body.device_id, 'device_id'),
      notes: cleanNotes(body.notes),
      createdBy: profile.id,
    });
  } catch (error) {
    throw mapInventoryDatabaseError(error);
  }
}

function validDecimal(value, { allowZero = false } = {}) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  if (typeof value === 'string' && value.length > 120) return null;
  const decimal = parseDecimal(value);
  if (!decimal || (allowZero ? decimal.units < 0n : decimal.units <= 0n)
    || decimal.scale > 16383) return null;
  const integerDigits = (decimal.units < 0n ? -decimal.units : decimal.units).toString().length
    - decimal.scale;
  if (integerDigits > 131072) return null;
  return decimal;
}

function validPositiveQuantity(value) {
  return validDecimal(value) ? (typeof value === 'string' ? value.trim() : value) : null;
}

export async function createQuantityMovement(profile, productId, body) {
  requireAdmin(profile);
  const id = validateUuid(productId, 'id');
  ensureObject(body);
  allowFields(body, ['movement_type', 'quantity', 'source_status', 'client_id', 'plant_id', 'notes']);
  if (!movementTypes.includes(body.movement_type)) throw codedError(400, 'movement_type inválido');
  const quantity = validPositiveQuantity(body.quantity);
  if (quantity === null) throw codedError(400, 'quantity inválida');
  if (body.source_status !== undefined && body.source_status !== null
    && !sourceStatuses.includes(body.source_status)) {
    throw codedError(400, 'source_status inválido');
  }
  try {
    const movement = await recordQuantityInventoryMovement({
      productId: id,
      movementType: body.movement_type,
      quantity,
      sourceStatus: body.source_status ?? null,
      clientId: cleanOptionalUuid(body.client_id, 'client_id'),
      plantId: cleanOptionalUuid(body.plant_id, 'plant_id'),
      notes: cleanNotes(body.notes),
      createdBy: profile.id,
    });
    return { ...movement, quantity: decimalString(parseDecimal(String(quantity))) };
  } catch (error) {
    throw mapInventoryDatabaseError(error);
  }
}

export async function getInventoryItems(profile, scope, productId, filters = {}) {
  const id = validateUuid(productId, 'id');
  if (filters.status !== undefined && !itemStatuses.includes(filters.status)) {
    throw codedError(400, 'status inválido');
  }
  const clientId = filters.clientId === undefined ? null : validateUuid(filters.clientId, 'clientId');
  const plantId = filters.plantId === undefined ? null : validateUuid(filters.plantId, 'plantId');
  const search = filters.search === undefined ? null : cleanText(filters.search, 'search', { max: 300 });
  const scoped = inventoryScope(profile, scope);
  if (scoped && (clientId && clientId !== scoped.client_id
    || plantId && !scoped.plantIds.has(plantId))) return [];
  await getInventoryProduct(profile, scope, id);
  return listInventoryItems({
    productId: id, status: filters.status ?? null, clientId, plantId, search, scope: scoped,
  });
}

function validDate(value, field) {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw codedError(400, `${field} inválido`);
  }
  return value;
}

export async function getInventoryMovements(profile, scope, filters = {}) {
  const productId = filters.productId === undefined ? null : validateUuid(filters.productId, 'productId');
  const itemId = filters.itemId === undefined ? null : validateUuid(filters.itemId, 'itemId');
  const clientId = filters.clientId === undefined ? null : validateUuid(filters.clientId, 'clientId');
  const plantId = filters.plantId === undefined ? null : validateUuid(filters.plantId, 'plantId');
  if (filters.movementType !== undefined && !movementTypes.includes(filters.movementType)) {
    throw codedError(400, 'movementType inválido');
  }
  const dateFrom = filters.dateFrom === undefined ? null : validDate(filters.dateFrom, 'dateFrom');
  const dateTo = filters.dateTo === undefined ? null : validDate(filters.dateTo, 'dateTo');
  const scoped = inventoryScope(profile, scope);
  if (scoped && (clientId && clientId !== scoped.client_id
    || plantId && !scoped.plantIds.has(plantId))) return [];
  return listInventoryMovements({
    productId,
    itemId,
    movementType: filters.movementType ?? null,
    clientId,
    plantId,
    dateFrom,
    dateTo,
    scope: scoped,
  });
}

export function mapInventoryDatabaseError(error) {
  if (Number.isSafeInteger(error?.statusCode)) return error;
  const message = String(error?.dbMessage ?? error?.message ?? '');
  const mappings = {
    PRODUCT_NOT_FOUND: [404, 'Producto no encontrado'],
    ITEM_NOT_FOUND: [404, 'Unidad no encontrada'],
    INVALID_SERIAL: [400, 'Serial inválido'],
    INVALID_QUANTITY: [400, 'Cantidad inválida'],
    INVALID_SOURCE_STATUS: [400, 'Estado de origen inválido'],
    INVALID_TRACKING_MODE: [409, 'Modo de seguimiento incompatible'],
    INVALID_TRANSITION: [409, 'Transición de inventario no permitida'],
    INSUFFICIENT_STOCK: [409, 'Stock insuficiente'],
    INVALID_CLIENT_PLANT: [400, 'Cliente o planta inválidos'],
    INACTIVE_CLIENT: [409, 'El cliente está inactivo'],
    DEVICE_PLANT_MISMATCH: [409, 'El dispositivo no pertenece a la planta'],
  };
  for (const [token, [status, publicMessage]] of Object.entries(mappings)) {
    if (message.includes(token)) return codedError(status, publicMessage);
  }
  if (error?.dbCode === '23505' || /duplicate|unique/i.test(message)) {
    return codedError(409, 'El serial ya está registrado');
  }
  if (error?.dbCode === '22003' || error?.dbCode === '22P02') {
    return codedError(400, 'Cantidad inválida');
  }
  if (message.includes('tracking_mode no puede cambiar')) {
    return codedError(409, 'No se puede cambiar tracking_mode después del primer uso');
  }
  return codedError(503, 'Error interno de inventario');
}
