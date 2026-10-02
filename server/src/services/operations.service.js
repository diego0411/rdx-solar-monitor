import { randomUUID } from 'node:crypto';
import {
  getInventoryProductById,
  listInventoryItems,
  listInventoryMovements,
  listInventoryProducts,
} from '../repositories/inventory.repository.js';
import {
  getDestinationClientById,
  getMaterialRequestById,
  getRequestLine,
  listActiveReservedItemIds,
  listAvailableSerials as listAvailableSerialsRepo,
  listDestinationClients as listDestinationClientsRepo,
  listDestinationClientsByIds,
  listInventoryItemsByIds,
  listMaterialRequests as listMaterialRequestsRepo,
  listPlantsByIds,
  listRequestEvents,
  listRequestItems,
  listRequestLines,
  listRequestLinesByRequestIds,
  listRequesterProfiles,
  rpcCancelMaterialRequest,
  rpcDeliverMaterialRequest,
  rpcMaterialRequestCreate,
  rpcMaterialRequestTransition,
  rpcPrepareSerializedItem,
  rpcReleaseSerializedItem,
  rpcSetPreparedQuantity,
} from '../repositories/operations.repository.js';
import { projectQuantityLedger } from './inventory.service.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasons = ['installation', 'maintenance', 'warranty', 'replacement', 'internal', 'other'];
const priorities = ['low', 'normal', 'high', 'urgent'];
const statuses = ['requested', 'received', 'preparing', 'ready', 'delivered', 'rejected', 'cancelled'];
const transitionTargets = ['received', 'preparing', 'ready', 'rejected'];
const warehouseRoles = ['rdx_admin', 'client_admin'];
// Motivos que admiten planta asociada. Para el resto, plant_id se
// normaliza a NULL (sin error por valores stale del frontend).
const plantReasons = ['maintenance', 'warranty', 'replacement'];

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

function optionalUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return validateUuid(value, field);
}

function ensureObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw codedError(400, 'Payload inválido');
  }
  return body;
}

function cleanText(value, field, { max = 4000 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw codedError(400, `${field} inválido`);
  const clean = value.trim();
  if (clean.length > max) throw codedError(400, `${field} inválido`);
  return clean === '' ? null : clean;
}

function cleanDateTime(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw codedError(400, `${field} inválido`);
  }
  return value;
}

// Cantidad positiva para API: acepta número finito o cadena decimal;
// se devuelve tal cual para que el RPC la interprete (jsonb).
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

function cleanNonNegativeQuantity(value, field) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw codedError(400, `${field} inválida`);
    return value;
  }
  if (typeof value === 'string') {
    const clean = value.trim();
    if (!/^[+]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(clean)) {
      throw codedError(400, `${field} inválida`);
    }
    const numeric = Number(clean);
    if (!Number.isFinite(numeric) || numeric < 0) throw codedError(400, `${field} inválida`);
    return clean;
  }
  throw codedError(400, `${field} inválida`);
}

function requireWarehouse(profile) {
  if (!warehouseRoles.includes(profile?.role)) throw codedError(403, 'Acceso denegado');
}

// Visibilidad por rol: client_user solo ve lo propio. Lo oculto se
// reporta como 404 (mismo patrón que maintenance fuera de scope).
function assertVisible(profile, request) {
  if (!request) throw codedError(404, 'Solicitud no encontrada');
  if (profile?.role === 'client_user' && request.requested_by !== profile.id) {
    throw codedError(404, 'Solicitud no encontrada');
  }
  return request;
}

export function resolveIdempotencyKey(value) {
  if (value === undefined || value === null) return randomUUID();
  if (typeof value !== 'string' || !uuidPattern.test(value.trim())) {
    throw codedError(400, 'Idempotency-Key inválido');
  }
  return value.trim().toLowerCase();
}

// Suma exacta de decimales en texto (evita artefactos binarios al
// agregar cantidades con la misma unidad en el listado).
function sumDecimalStrings(values) {
  let scale = 0;
  const parsed = values.map(raw => {
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(raw).trim());
    if (!match) return null;
    return { sign: match[1] === '-' ? -1n : 1n, int: match[2], frac: match[3] ?? '' };
  });
  if (parsed.some(part => !part)) return null;
  scale = Math.max(...parsed.map(part => part.frac.length));
  let total = 0n;
  for (const part of parsed) {
    total += part.sign * BigInt(`${part.int}${part.frac.padEnd(scale, '0')}` || '0');
  }
  const negative = total < 0n;
  let digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  let result = scale === 0
    ? digits
    : `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`
      .replace(/\.?0+$/, '');
  if (result === '') result = '0';
  return `${negative ? '-' : ''}${result}`;
}

function cleanListFilters(filters = {}) {
  const clean = {};
  if (filters.status !== undefined) {
    if (!statuses.includes(filters.status)) throw codedError(400, 'status inválido');
    clean.status = filters.status;
  }
  if (filters.priority !== undefined) {
    if (!priorities.includes(filters.priority)) throw codedError(400, 'priority inválido');
    clean.priority = filters.priority;
  }
  if (filters.reason !== undefined) {
    if (!reasons.includes(filters.reason)) throw codedError(400, 'reason inválido');
    clean.reason = filters.reason;
  }
  if (filters.plantId !== undefined) clean.plantId = validateUuid(filters.plantId, 'plantId');
  if (filters.dateFrom !== undefined) {
    if (typeof filters.dateFrom !== 'string' || !Number.isFinite(Date.parse(filters.dateFrom))) {
      throw codedError(400, 'dateFrom inválido');
    }
    clean.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo !== undefined) {
    if (typeof filters.dateTo !== 'string' || !Number.isFinite(Date.parse(filters.dateTo))) {
      throw codedError(400, 'dateTo inválido');
    }
    clean.dateTo = filters.dateTo;
  }
  return clean;
}

function summarizeRequest(request, { requesterName, plantName, destinationClientName, lineCount, requestedTotal, requestedUnit }) {
  return {
    id: request.id,
    code: request.code,
    status: request.status,
    reason: request.reason,
    priority: request.priority,
    destination: request.destination,
    destination_client_id: request.destination_client_id ?? null,
    destination_client: request.destination_client_id
      ? { id: request.destination_client_id, name: destinationClientName }
      : null,
    required_at: request.required_at,
    requested_by: request.requested_by,
    requester: { id: request.requested_by, display_name: requesterName },
    plant_id: request.plant_id,
    plant: request.plant_id ? { id: request.plant_id, name: plantName } : null,
    maintenance_visit_id: request.maintenance_visit_id,
    created_at: request.created_at,
    updated_at: request.updated_at,
    line_count: lineCount,
    requested_total: requestedTotal,
    requested_unit: requestedUnit,
  };
}

export async function listMaterialRequests(profile, filters = {}) {
  const clean = cleanListFilters(filters);
  // client_user: solo propias. Sin filtro por client_id ni plantas.
  const requestedBy = profile?.role === 'client_user' ? profile.id : null;
  const requests = await listMaterialRequestsRepo({ ...clean, requestedBy }).catch(error => {
    throw mapOperationsDatabaseError(error);
  });
  const ids = requests.map(request => request.id);
  const [profiles, plants, lines, destinationClients] = await Promise.all([
    listRequesterProfiles(requests.map(request => request.requested_by))
      .catch(error => { throw mapOperationsDatabaseError(error); }),
    listPlantsByIds(requests.map(request => request.plant_id))
      .catch(error => { throw mapOperationsDatabaseError(error); }),
    listRequestLinesByRequestIds(ids).catch(error => { throw mapOperationsDatabaseError(error); }),
    listDestinationClientsByIds(requests.map(request => request.destination_client_id))
      .catch(error => { throw mapOperationsDatabaseError(error); }),
  ]);
  const requesterById = new Map(profiles.map(row => [row.id, row.display_name ?? null]));
  const plantById = new Map(plants.map(row => [row.id, row.name ?? null]));
  const destinationClientById = new Map(destinationClients.map(row => [row.id, row.name ?? null]));
  const productUnits = new Map();
  const productIds = [...new Set(lines.map(line => line.product_id))];
  if (productIds.length > 0) {
    const products = await listInventoryProducts({}).catch(error => {
      throw mapOperationsDatabaseError(error);
    });
    for (const product of products) productUnits.set(product.id, product.unit ?? null);
  }
  const linesByRequest = new Map();
  for (const line of lines) {
    if (!linesByRequest.has(line.request_id)) linesByRequest.set(line.request_id, []);
    linesByRequest.get(line.request_id).push(line);
  }
  return requests.map(request => {
    const requestLines = linesByRequest.get(request.id) ?? [];
    const units = new Set(requestLines.map(line => productUnits.get(line.product_id) ?? null));
    // Total agregado solo si todas las líneas comparten unidad; si no,
    // no se inventa agregado (unidades incompatibles).
    let requestedTotal = null;
    let requestedUnit = null;
    if (requestLines.length > 0 && units.size === 1) {
      const [unit] = [...units];
      const total = sumDecimalStrings(requestLines.map(line => line.requested_quantity));
      if (total !== null) {
        requestedTotal = total;
        requestedUnit = unit;
      }
    }
    return summarizeRequest(request, {
      requesterName: requesterById.get(request.requested_by) ?? null,
      plantName: request.plant_id ? plantById.get(request.plant_id) ?? null : null,
      destinationClientName: request.destination_client_id
        ? destinationClientById.get(request.destination_client_id) ?? null
        : null,
      lineCount: requestLines.length,
      requestedTotal,
      requestedUnit,
    });
  });
}

export async function getMaterialRequestDetail(profile, id) {
  const requestId = validateUuid(id, 'id');
  let request;
  try {
    request = await getMaterialRequestById(requestId);
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
  assertVisible(profile, request);
  let lines;
  let events;
  try {
    [lines, events] = await Promise.all([
      listRequestLines(requestId),
      listRequestEvents(requestId),
    ]);
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
  let items = [];
  let products = [];
  let serials = [];
  try {
    items = await listRequestItems(lines.map(line => line.id));
    const productIds = [...new Set(lines.map(line => line.product_id))];
    const allProducts = await listInventoryProducts({});
    products = allProducts.filter(product => productIds.includes(product.id));
    const itemIds = items.map(item => item.inventory_item_id);
    serials = await listInventoryItemsByIds(itemIds);
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
  const productById = new Map(products.map(product => [product.id, product]));
  const serialById = new Map(serials.map(item => [item.id, item]));
  let requesterName = null;
  let plantName = null;
  let destinationClientName = null;
  try {
    const [profiles, plants, destinationClients] = await Promise.all([
      listRequesterProfiles([request.requested_by]),
      listPlantsByIds([request.plant_id]),
      listDestinationClientsByIds([request.destination_client_id]),
    ]);
    requesterName = profiles[0]?.display_name ?? null;
    plantName = plants[0]?.name ?? null;
    destinationClientName = destinationClients[0]?.name ?? null;
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
  return {
    request: {
      ...request,
      requester: { id: request.requested_by, display_name: requesterName },
      plant: request.plant_id ? { id: request.plant_id, name: plantName } : null,
      destination_client: request.destination_client_id
        ? { id: request.destination_client_id, name: destinationClientName }
        : null,
    },
    lines: lines.map(line => {
      const product = productById.get(line.product_id);
      return {
        ...line,
        product: product ? {
          id: product.id,
          name: product.name,
          category: product.category,
          manufacturer: product.manufacturer ?? null,
          model: product.model ?? null,
          tracking_mode: product.tracking_mode,
          unit: product.unit ?? null,
        } : { id: line.product_id },
      };
    }),
    items: items.map(item => ({
      id: item.id,
      request_line_id: item.request_line_id,
      inventory_item_id: item.inventory_item_id,
      serial_number: serialById.get(item.inventory_item_id)?.serial_number ?? null,
      prepared_by: item.prepared_by,
      prepared_at: item.prepared_at,
      delivered_at: item.delivered_at,
      released_at: item.released_at,
    })),
    events,
  };
}

function cleanCreateLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw codedError(400, 'lines requerido');
  }
  const seen = new Set();
  return lines.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw codedError(400, `lines[${index}] inválida`);
    }
    const productId = validateUuid(line.product_id, `lines[${index}].product_id`);
    if (seen.has(productId)) throw codedError(400, 'Producto duplicado en líneas');
    seen.add(productId);
    return {
      product_id: productId,
      requested_quantity: cleanPositiveQuantity(line.requested_quantity, `lines[${index}].requested_quantity`),
      ...(line.observations === undefined || line.observations === null
        ? {}
        : { observations: cleanText(line.observations, `lines[${index}].observations`) }),
    };
  });
}

export async function createMaterialRequest(profile, body) {
  const payload = ensureObject(body);
  if (!reasons.includes(payload.reason)) throw codedError(400, 'reason inválido');
  const priority = payload.priority === undefined ? 'normal' : payload.priority;
  if (!priorities.includes(priority)) throw codedError(400, 'priority inválido');
  const lines = cleanCreateLines(payload.lines);
  // Planta solo para maintenance/warranty/replacement; en otro caso se
  // normaliza a NULL sin error (el frontend puede enviar un valor stale).
  const plantId = plantReasons.includes(payload.reason)
    ? optionalUuid(payload.plant_id, 'plant_id')
    : null;
  // Cliente destino: catálogo comercial activo. No se usa para autorización.
  const destinationClientId = optionalUuid(payload.destination_client_id, 'destination_client_id');
  if (destinationClientId !== null) {
    let destinationClient;
    try {
      destinationClient = await getDestinationClientById(destinationClientId);
    } catch (error) {
      throw mapOperationsDatabaseError(error);
    }
    if (!destinationClient || destinationClient.active !== true || destinationClient.is_commercial !== true) {
      throw codedError(404, 'Cliente destino no encontrado');
    }
  }
  // requested_by siempre es la identidad autenticada; se ignora el body.
  const args = {
    actorId: profile.id,
    reason: payload.reason,
    lines,
    priority,
    plantId,
    maintenanceVisitId: optionalUuid(payload.maintenance_visit_id, 'maintenance_visit_id'),
    destination: payload.destination === undefined ? null : cleanText(payload.destination, 'destination', { max: 400 }),
    requiredAt: cleanDateTime(payload.required_at, 'required_at'),
    observations: payload.observations === undefined ? null : cleanText(payload.observations, 'observations'),
    destinationClientId,
  };
  try {
    return await rpcMaterialRequestCreate(args);
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export async function listDestinationClients(profile) {
  void profile;
  try {
    const clients = await listDestinationClientsRepo();
    return clients.map(client => ({
      id: client.id,
      name: client.name,
      phone: client.phone ?? null,
      email: client.email ?? null,
    }));
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export async function transitionMaterialRequest(profile, id, body, idempotencyKey) {
  requireWarehouse(profile);
  const requestId = validateUuid(id, 'id');
  const targetStatus = ensureObject(body).target_status;
  if (!transitionTargets.includes(targetStatus)) throw codedError(400, 'target_status inválido');
  const key = resolveIdempotencyKey(idempotencyKey);
  try {
    return await rpcMaterialRequestTransition({
      requestId, targetStatus, actorId: profile.id, idempotencyKey: key,
    });
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export async function prepareSerializedItem(profile, requestId, lineId, body) {
  requireWarehouse(profile);
  const request = validateUuid(requestId, 'id');
  const line = validateUuid(lineId, 'lineId');
  const payload = ensureObject(body);
  const inventoryItemId = validateUuid(payload.inventory_item_id, 'inventory_item_id');
  const observations = payload.observations === undefined
    ? null
    : cleanText(payload.observations, 'observations');
  try {
    return await rpcPrepareSerializedItem({
      requestId: request,
      lineId: line,
      inventoryItemId,
      actorId: profile.id,
      observations,
    });
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export async function releaseSerializedItem(profile, requestId, lineId, itemId, body) {
  requireWarehouse(profile);
  const request = validateUuid(requestId, 'id');
  const line = validateUuid(lineId, 'lineId');
  const inventoryItemId = validateUuid(itemId, 'itemId');
  const payload = body === undefined ? {} : ensureObject(body);
  const observations = payload.observations === undefined
    ? null
    : cleanText(payload.observations, 'observations');
  try {
    return await rpcReleaseSerializedItem({
      requestId: request,
      lineId: line,
      inventoryItemId,
      actorId: profile.id,
      observations,
    });
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export async function setPreparedQuantity(profile, requestId, lineId, body) {
  requireWarehouse(profile);
  const request = validateUuid(requestId, 'id');
  const line = validateUuid(lineId, 'lineId');
  const payload = ensureObject(body);
  if (payload.prepared_quantity === undefined) throw codedError(400, 'prepared_quantity requerida');
  const preparedQuantity = cleanNonNegativeQuantity(payload.prepared_quantity, 'prepared_quantity');
  const observations = payload.observations === undefined
    ? null
    : cleanText(payload.observations, 'observations');
  try {
    return await rpcSetPreparedQuantity({
      requestId: request,
      lineId: line,
      preparedQuantity,
      actorId: profile.id,
      observations,
    });
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export async function cancelMaterialRequest(profile, id, idempotencyKey) {
  const requestId = validateUuid(id, 'id');
  const key = resolveIdempotencyKey(idempotencyKey);
  if (profile?.role === 'client_user') {
    // client_user solo puede cancelar lo propio; el RPC valida el estado.
    let request;
    try {
      request = await getMaterialRequestById(requestId);
    } catch (error) {
      throw mapOperationsDatabaseError(error);
    }
    assertVisible(profile, request);
  } else if (!warehouseRoles.includes(profile?.role)) {
    throw codedError(403, 'Acceso denegado');
  }
  try {
    return await rpcCancelMaterialRequest({ requestId, actorId: profile.id, idempotencyKey: key });
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export async function deliverMaterialRequest(profile, id, body, idempotencyKey) {
  requireWarehouse(profile);
  const requestId = validateUuid(id, 'id');
  const payload = ensureObject(body);
  const deliveries = payload.deliveries;
  if (!deliveries || typeof deliveries !== 'object' || Array.isArray(deliveries)
    || Object.keys(deliveries).length === 0) {
    throw codedError(400, 'deliveries inválido');
  }
  // Validación básica de formato; todas las líneas deben enviarse
  // explícitamente y el RPC rechaza faltantes/sobrantes sin reinterpretar.
  const clean = {};
  for (const [lineId, quantity] of Object.entries(deliveries)) {
    const line = validateUuid(lineId, 'deliveries key');
    clean[line] = cleanNonNegativeQuantity(quantity, `deliveries[${lineId}]`);
  }
  const key = resolveIdempotencyKey(idempotencyKey);
  try {
    // El RPC 031 ejecuta el dispatch atómico (inventory_movements +
    // inventory_items). Node no escribe inventario directamente.
    return await rpcDeliverMaterialRequest({
      requestId, actorId: profile.id, deliveries: clean, idempotencyKey: key,
    });
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export async function listAvailableProducts(profile) {
  void profile;
  let products;
  try {
    products = (await listInventoryProducts({})).filter(product => product.active !== false);
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
  let items = [];
  let movements = [];
  let reserved = [];
  try {
    [items, movements, reserved] = await Promise.all([
      listInventoryItems({}),
      listInventoryMovements({}),
      listActiveReservedItemIds(),
    ]);
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
  const reservedSet = new Set(reserved);
  return products.map(product => {
    const base = {
      id: product.id,
      name: product.name,
      category: product.category,
      manufacturer: product.manufacturer ?? null,
      model: product.model ?? null,
      tracking_mode: product.tracking_mode,
      unit: product.unit ?? null,
    };
    if (product.tracking_mode === 'serialized') {
      const productItems = items.filter(item => item.product_id === product.id);
      const availableItems = productItems.filter(item => item.status === 'available');
      const free = availableItems.filter(item => !reservedSet.has(item.id));
      const physical = productItems.filter(item => ['available', 'assigned', 'installed']
        .includes(item.status)).length;
      return {
        ...base,
        availability: {
          available_count: free.length,
          reserved_count: availableItems.length - free.length,
          physical_stock: String(physical),
        },
      };
    }
    // quantity: reutiliza la proyección del ledger de inventario (global,
    // sin scope de plantas). No se duplica el cálculo.
    try {
      const ledger = projectQuantityLedger(
        movements.filter(movement => movement.product_id === product.id),
      );
      return {
        ...base,
        availability: { available: ledger.available, physical_stock: ledger.physical_stock },
      };
    } catch {
      return { ...base, availability: null };
    }
  });
}

export async function listAvailableSerials(profile, requestId, lineId) {
  requireWarehouse(profile);
  const request = validateUuid(requestId, 'id');
  const line = validateUuid(lineId, 'lineId');
  let requestLine;
  try {
    requestLine = await getRequestLine(request, line);
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
  if (!requestLine) throw codedError(404, 'Línea no encontrada');
  let product;
  try {
    product = await getInventoryProductById(requestLine.product_id);
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
  if (!product) throw codedError(404, 'Producto no encontrado');
  if (product.tracking_mode !== 'serialized') {
    throw codedError(400, 'La línea no es serialized');
  }
  try {
    // Solo seriales available del producto de la línea, excluyendo
    // reservas activas (lo garantiza el repositorio).
    const serials = await listAvailableSerialsRepo(product.id);
    return serials.map(item => ({
      id: item.id,
      serial_number: item.serial_number,
      product_id: item.product_id,
      status: item.status,
      plant_id: item.plant_id,
      client_id: item.client_id ?? null,
    }));
  } catch (error) {
    throw mapOperationsDatabaseError(error);
  }
}

export function mapOperationsDatabaseError(error) {
  if (Number.isSafeInteger(error?.statusCode)) return error;
  const message = String(error?.dbMessage ?? error?.message ?? '');
  const mappings = {
    REQUEST_NOT_FOUND: [404, 'Solicitud no encontrada'],
    REQUEST_LINE_NOT_FOUND: [404, 'Línea no encontrada'],
    ACTIVE_PREPARED_ITEM_NOT_FOUND: [404, 'Serial preparado no encontrado'],
    PRODUCT_NOT_FOUND: [404, 'Producto no encontrado'],
    ITEM_NOT_FOUND: [404, 'Unidad no encontrada'],
    ACTOR_NOT_FOUND: [404, 'Solicitante no válido'],
    INVALID_DESTINATION_CLIENT: [404, 'Cliente destino no encontrado'],
    INVALID_REQUEST_LINES: [400, 'Líneas de solicitud inválidas'],
    DUPLICATE_REQUEST_PRODUCT: [400, 'Producto duplicado en líneas'],
    INVALID_DELIVERIES: [400, 'Entregas inválidas'],
    INVALID_DELIVERY_QUANTITY: [400, 'Cantidad de entrega inválida'],
    DELIVERY_LINES_MISMATCH: [400, 'Las entregas deben incluir todas las líneas'],
    INVALID_PREPARED_QUANTITY: [400, 'Cantidad preparada inválida'],
    INVALID_TRACKING_MODE: [409, 'Modo de seguimiento incompatible'],
    INVALID_REQUEST_TRANSITION: [409, 'Transición no permitida'],
    PREPARATION_INCONSISTENT: [409, 'Preparación inconsistente'],
    PREPARED_ITEMS_MISMATCH: [409, 'Preparación inconsistente'],
    PREPARED_QUANTITY_EXCEEDS_REQUESTED: [409, 'La cantidad preparada excede lo solicitado'],
    ITEM_PRODUCT_MISMATCH: [409, 'El serial no pertenece al producto de la línea'],
    ITEM_NOT_AVAILABLE: [409, 'El serial no está disponible'],
    ITEM_ALREADY_RESERVED: [409, 'El serial ya está reservado'],
    INSUFFICIENT_STOCK: [409, 'Stock insuficiente'],
    IDEMPOTENCY_PAYLOAD_MISMATCH: [409, 'La clave de idempotencia no coincide con el payload'],
    MATERIAL_REQUEST_CODE_LIMIT_REACHED: [409, 'Límite de folios alcanzado'],
  };
  for (const [token, [status, publicMessage]] of Object.entries(mappings)) {
    if (message.includes(token)) return codedError(status, publicMessage);
  }
  if (error?.dbCode === '23505' || /duplicate|unique/i.test(message)) {
    return codedError(409, 'La solicitud ya fue registrada');
  }
  if (error?.dbCode === '23503') {
    return codedError(404, 'Referencia no encontrada');
  }
  if (error?.dbCode === '22P02' || error?.dbCode === '22003') {
    return codedError(400, 'Cantidad inválida');
  }
  return codedError(503, 'Error interno de operaciones');
}
