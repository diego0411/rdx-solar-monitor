import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const REQ_OWN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQ_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINE_S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LINE_Q = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROD_S = '11111111-1111-4111-8111-111111111111';
const PROD_Q = '22222222-2222-4222-8222-222222222222';
const ITEM_FREE = '33333333-3333-4333-8333-333333333333';
const ITEM_RESERVED = '44444444-4444-4444-8444-444444444444';
const ITEM_SOLD = '55555555-5555-4555-8555-555555555555';
const PLANT_A = '66666666-6666-4666-8666-666666666666';

const RDX_ADMIN = { id: '99999999-9999-4999-8999-999999999999', role: 'rdx_admin' };
const CLIENT_ADMIN = { id: '88888888-8888-4888-8888-888888888888', role: 'client_admin' };
const CLIENT_USER = { id: '77777777-7777-4777-8777-777777777777', role: 'client_user' };
const OTHER_USER = { id: '66666666-1111-4666-8666-666666666666', role: 'client_user' };

const state = {
  requests: [],
  lines: [],
  items: [],
  events: [],
  products: [],
  invItems: [],
  movements: [],
  reserved: [],
  clients: [],
  calls: [],
  listFilters: null,
  nextError: null,
};

function maybeThrow() {
  if (state.nextError) {
    const error = state.nextError;
    state.nextError = null;
    throw error;
  }
}

function dbError(message, code = 'P0001') {
  const error = new Error(message);
  error.dbCode = code;
  error.dbMessage = message;
  return error;
}

mock.module('../src/repositories/operations.repository.js', {
  namedExports: {
    async listMaterialRequests(filters = {}) {
      state.listFilters = filters;
      return state.requests
        .filter(row => !filters.requestedBy || row.requested_by === filters.requestedBy)
        .filter(row => !filters.status || row.status === filters.status)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async getMaterialRequestById(id) {
      return state.requests.find(row => row.id === id) ?? null;
    },
    async listRequestLines(requestId) {
      return state.lines.filter(line => line.request_id === requestId);
    },
    async listRequestLinesByRequestIds(ids) {
      return state.lines.filter(line => ids.includes(line.request_id));
    },
    async getRequestLine(requestId, lineId) {
      return state.lines.find(line => line.request_id === requestId && line.id === lineId) ?? null;
    },
    async listRequestItems(lineIds) {
      return state.items.filter(item => lineIds.includes(item.request_line_id));
    },
    async listRequestEvents(requestId) {
      return state.events.filter(event => event.request_id === requestId);
    },
    async listRequesterProfiles(ids) {
      return ids.map(id => ({ id, display_name: `User ${id.slice(0, 4)}` }));
    },
    async listDestinationClients() {
      return state.clients.filter(client => client.active && client.is_commercial);
    },
    async getDestinationClientById(id) {
      return state.clients.find(client => client.id === id) ?? null;
    },
    async listDestinationClientsByIds(ids) {
      return state.clients.filter(client => ids.includes(client.id));
    },
    async listPlantsByIds(ids) {
      return ids.filter(Boolean).map(id => ({ id, name: 'Planta Norte' }));
    },
    async listInventoryItemsByIds(ids) {
      return state.invItems.filter(item => ids.includes(item.id));
    },
    async listActiveReservedItemIds() {
      return [...state.reserved];
    },
    async listAvailableSerials(productId) {
      const reserved = new Set(state.reserved);
      return state.invItems.filter(item =>
        item.product_id === productId && item.status === 'available' && !reserved.has(item.id));
    },
    async rpcMaterialRequestCreate(args) {
      maybeThrow();
      state.calls.push({ method: 'create', args });
      return { id: REQ_OWN, code: 'MAT-2026-0001', ...args };
    },
    async rpcMaterialRequestTransition(args) {
      maybeThrow();
      state.calls.push({ method: 'transition', args });
      return { id: args.requestId, status: args.targetStatus };
    },
    async rpcPrepareSerializedItem(args) {
      maybeThrow();
      state.calls.push({ method: 'prepare', args });
      return { id: args.lineId, prepared_quantity: '1' };
    },
    async rpcReleaseSerializedItem(args) {
      maybeThrow();
      state.calls.push({ method: 'release', args });
      return { id: args.lineId, prepared_quantity: '0' };
    },
    async rpcSetPreparedQuantity(args) {
      maybeThrow();
      state.calls.push({ method: 'setQuantity', args });
      return { id: args.lineId, prepared_quantity: String(args.preparedQuantity) };
    },
    async rpcCancelMaterialRequest(args) {
      maybeThrow();
      state.calls.push({ method: 'cancel', args });
      return { id: args.requestId, status: 'cancelled' };
    },
    async rpcDeliverMaterialRequest(args) {
      maybeThrow();
      state.calls.push({ method: 'deliver', args });
      return { id: args.requestId, status: 'delivered' };
    },
  },
});

// La cadena real inventory.service -> inventory.repository se mockea completa:
// projectQuantityLedger es puro y se conserva; los writes vigilan no-escritura.
const inventoryWrites = [];
mock.module('../src/repositories/inventory.repository.js', {
  namedExports: {
    async listInventoryProducts() {
      return state.products;
    },
    async getInventoryProductById(id) {
      return state.products.find(product => product.id === id) ?? null;
    },
    async listInventoryItems() {
      return state.invItems;
    },
    async listInventoryMovements() {
      return state.movements;
    },
    async insertInventoryProduct(values) {
      inventoryWrites.push({ method: 'insertProduct', values });
      return values;
    },
    async updateInventoryProduct(id, values) {
      inventoryWrites.push({ method: 'updateProduct', id, values });
      return values;
    },
    async createSerializedInventoryItem(values) {
      inventoryWrites.push({ method: 'createItem', values });
      return values;
    },
    async transitionSerializedInventoryItem(values) {
      inventoryWrites.push({ method: 'transitionItem', values });
      return values;
    },
    async recordQuantityInventoryMovement(values) {
      inventoryWrites.push({ method: 'quantityMovement', values });
      return values;
    },
  },
});

const service = await import('../src/services/operations.service.js');

function seed() {
  state.requests = [
    {
      id: REQ_OWN, code: 'MAT-2026-0001', requested_by: CLIENT_USER.id, plant_id: PLANT_A,
      maintenance_visit_id: null, reason: 'maintenance', priority: 'high', status: 'requested',
      destination: 'Bodega norte', required_at: null, observations: null,
      created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
    },
    {
      id: REQ_OTHER, code: 'MAT-2026-0002', requested_by: OTHER_USER.id, plant_id: null,
      maintenance_visit_id: null, reason: 'installation', priority: 'normal', status: 'preparing',
      destination: null, required_at: null, observations: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    },
  ];
  state.lines = [
    {
      id: LINE_S, request_id: REQ_OWN, product_id: PROD_S,
      requested_quantity: '2', prepared_quantity: '1', delivered_quantity: '0',
      observations: null, created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
    },
    {
      id: LINE_Q, request_id: REQ_OWN, product_id: PROD_Q,
      requested_quantity: '5', prepared_quantity: '5', delivered_quantity: '0',
      observations: null, created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
    },
  ];
  state.items = [{
    id: '99999999-1111-4111-8111-999999999999', request_line_id: LINE_S,
    inventory_item_id: ITEM_RESERVED, prepared_by: CLIENT_ADMIN.id,
    prepared_at: '2026-02-02T00:00:00.000Z', delivered_at: null, released_at: null,
  }];
  state.events = [{
    id: '99999999-2222-4222-8222-999999999999', request_id: REQ_OWN, event_type: 'requested',
    actor_id: CLIENT_USER.id, metadata: {}, idempotency_key: null,
    created_at: '2026-02-01T00:00:00.000Z',
  }];
  state.products = [
    {
      id: PROD_S, name: 'Inversor', category: 'inverter', manufacturer: 'RDX', model: 'INV-5K',
      unit: 'pza', tracking_mode: 'serialized', active: true,
    },
    {
      id: PROD_Q, name: 'Cable', category: 'cable', manufacturer: null, model: null,
      unit: 'kg', tracking_mode: 'quantity', active: true,
    },
  ];
  state.invItems = [
    {
      id: ITEM_FREE, product_id: PROD_S, serial_number: 'SN-FREE', status: 'available',
      plant_id: null, client_id: null,
    },
    {
      id: ITEM_RESERVED, product_id: PROD_S, serial_number: 'SN-RES', status: 'available',
      plant_id: null, client_id: null,
    },
    {
      id: ITEM_SOLD, product_id: PROD_S, serial_number: 'SN-SOLD', status: 'sold',
      plant_id: PLANT_A, client_id: null,
    },
  ];
  state.movements = [
    {
      product_id: PROD_Q, movement_type: 'in', quantity: '10',
      from_status: null, to_status: 'available',
    },
    {
      product_id: PROD_Q, movement_type: 'assign', quantity: '4',
      from_status: 'available', to_status: 'assigned',
    },
  ];
  state.reserved = [ITEM_RESERVED];
  state.clients = [
    { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Cliente Activo', active: true, is_commercial: true },
    { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: 'Cliente Inactivo', active: false, is_commercial: true },
    { id: 'cccccccc-3333-4333-8333-cccccccccccc', name: 'Legacy No Comercial', active: true, is_commercial: false },
  ];
  state.calls = [];
  state.listFilters = null;
  state.nextError = null;
  inventoryWrites.length = 0;
}

beforeEach(seed);

test('1. client_user solo lista y lee sus propias solicitudes', async () => {
  const rows = await service.listMaterialRequests(CLIENT_USER, {});
  assert.equal(state.listFilters.requestedBy, CLIENT_USER.id);
  assert.deepEqual(rows.map(row => row.id), [REQ_OWN]);
  assert.equal(rows[0].line_count, 2);
  // Unidades distintas (pza vs kg): sin total agregado inventado.
  assert.equal(rows[0].requested_total, null);

  await assert.rejects(
    service.getMaterialRequestDetail(CLIENT_USER, REQ_OTHER),
    error => error.statusCode === 404,
  );
  const detail = await service.getMaterialRequestDetail(CLIENT_USER, REQ_OWN);
  assert.equal(detail.request.id, REQ_OWN);
  assert.equal(detail.lines.length, 2);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].serial_number, 'SN-RES');
  assert.equal(detail.events.length, 1);
  assert.equal(detail.lines[0].product.tracking_mode, 'serialized');
});

test('2. client_admin y rdx_admin ven todas sin filtro de autor', async () => {
  for (const profile of [CLIENT_ADMIN, RDX_ADMIN]) {
    const rows = await service.listMaterialRequests(profile, {});
    assert.equal(state.listFilters.requestedBy, null);
    assert.deepEqual(rows.map(row => row.id), [REQ_OWN, REQ_OTHER]);
    const detail = await service.getMaterialRequestDetail(profile, REQ_OTHER);
    assert.equal(detail.request.id, REQ_OTHER);
  }
});

test('3. create fuerza requested_by = profile.id e ignora el body', async () => {
  const created = await service.createMaterialRequest(CLIENT_USER, {
    reason: 'maintenance',
    priority: 'urgent',
    plant_id: PLANT_A,
    requested_by: OTHER_USER.id,
    lines: [{ product_id: PROD_S, requested_quantity: 2 }],
  });
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].method, 'create');
  assert.equal(state.calls[0].args.actorId, CLIENT_USER.id);
  assert.ok(!('requestedBy' in state.calls[0].args));
  assert.equal(created.code, 'MAT-2026-0001');

  await assert.rejects(
    service.createMaterialRequest(CLIENT_USER, { reason: 'bad', lines: [{ product_id: PROD_S, requested_quantity: 1 }] }),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createMaterialRequest(CLIENT_USER, { reason: 'maintenance', lines: [] }),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createMaterialRequest(CLIENT_USER, {
      reason: 'maintenance', lines: [{ product_id: PROD_S, requested_quantity: 0 }],
    }),
    error => error.statusCode === 400,
  );
  assert.equal(state.calls.length, 1);
});

test('4. client_user no puede transition/prepare/release/quantity/deliver', async () => {
  const key = '12345678-1234-4234-8234-123456789012';
  await assert.rejects(
    service.transitionMaterialRequest(CLIENT_USER, REQ_OWN, { target_status: 'received' }, key),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.prepareSerializedItem(CLIENT_USER, REQ_OWN, LINE_S, { inventory_item_id: ITEM_FREE }),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.releaseSerializedItem(CLIENT_USER, REQ_OWN, LINE_S, ITEM_RESERVED, {}),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.setPreparedQuantity(CLIENT_USER, REQ_OWN, LINE_Q, { prepared_quantity: 3 }),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.deliverMaterialRequest(CLIENT_USER, REQ_OWN, { deliveries: { [LINE_S]: 1 } }, key),
    error => error.statusCode === 403,
  );
  assert.equal(state.calls.length, 0);
});

test('4b. client_user solo cancela lo propio; lo ajeno es 404', async () => {
  await assert.rejects(
    service.cancelMaterialRequest(CLIENT_USER, REQ_OTHER, null),
    error => error.statusCode === 404,
  );
  assert.equal(state.calls.length, 0);
  const cancelled = await service.cancelMaterialRequest(CLIENT_USER, REQ_OWN, null);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(state.calls[0].method, 'cancel');
  assert.equal(state.calls[0].args.actorId, CLIENT_USER.id);
});

test('5. client_admin puede procesar: transition/prepare/release/quantity/deliver/cancel', async () => {
  const key = '12345678-1234-4234-8234-123456789012';
  await service.transitionMaterialRequest(CLIENT_ADMIN, REQ_OWN, { target_status: 'received' }, key);
  await service.prepareSerializedItem(CLIENT_ADMIN, REQ_OWN, LINE_S, { inventory_item_id: ITEM_FREE });
  await service.releaseSerializedItem(CLIENT_ADMIN, REQ_OWN, LINE_S, ITEM_RESERVED, {});
  await service.setPreparedQuantity(CLIENT_ADMIN, REQ_OWN, LINE_Q, { prepared_quantity: 4 });
  await service.deliverMaterialRequest(
    CLIENT_ADMIN, REQ_OWN, { deliveries: { [LINE_S]: 1, [LINE_Q]: 4 } }, key,
  );
  await service.cancelMaterialRequest(CLIENT_ADMIN, REQ_OTHER, key);
  assert.deepEqual(state.calls.map(call => call.method), [
    'transition', 'prepare', 'release', 'setQuantity', 'deliver', 'cancel',
  ]);
  assert.ok(state.calls.every(call => call.args.actorId === CLIENT_ADMIN.id));
});

test('6. deliver delega al RPC sin escribir inventario desde Node', async () => {
  const key = '12345678-1234-4234-8234-123456789012';
  const deliveries = { [LINE_S]: 2, [LINE_Q]: '5' };
  await service.deliverMaterialRequest(CLIENT_ADMIN, REQ_OWN, { deliveries }, key);
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.calls[0].args.deliveries, deliveries);
  assert.equal(state.calls[0].args.idempotencyKey, key);
  assert.equal(inventoryWrites.length, 0);
  // Sin reinterpretación: líneas faltantes/malformadas se rechazan en Node.
  await assert.rejects(
    service.deliverMaterialRequest(CLIENT_ADMIN, REQ_OWN, { deliveries: {} }, key),
    error => error.statusCode === 400,
  );
  assert.equal(state.calls.length, 1);
});

test('6b. idempotency: genera UUID si falta, propaga si viene, rechaza si inválida', async () => {
  await service.transitionMaterialRequest(CLIENT_ADMIN, REQ_OWN, { target_status: 'received' }, null);
  const generated = state.calls[0].args.idempotencyKey;
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const key = '12345678-1234-4234-8234-123456789012';
  await service.transitionMaterialRequest(CLIENT_ADMIN, REQ_OWN, { target_status: 'received' }, key);
  assert.equal(state.calls[1].args.idempotencyKey, key);
  await assert.rejects(
    service.transitionMaterialRequest(CLIENT_ADMIN, REQ_OWN, { target_status: 'received' }, 'no-uuid'),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.transitionMaterialRequest(CLIENT_ADMIN, REQ_OWN, { target_status: 'delivered' }, key),
    error => error.statusCode === 400,
  );
});

test('7. available-items excluye reservados y no-available; línea quantity se rechaza', async () => {
  const serials = await service.listAvailableSerials(CLIENT_ADMIN, REQ_OWN, LINE_S);
  assert.deepEqual(serials.map(item => item.serial_number), ['SN-FREE']);
  await assert.rejects(
    service.listAvailableSerials(CLIENT_ADMIN, REQ_OWN, LINE_Q),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.listAvailableSerials(CLIENT_USER, REQ_OWN, LINE_S),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.listAvailableSerials(CLIENT_ADMIN, REQ_OWN, '99999999-9999-4999-8999-999999999999'),
    error => error.statusCode === 404,
  );
});

test('7b. products expone disponibilidad reutilizando el ledger de inventario', async () => {
  const products = await service.listAvailableProducts(CLIENT_USER);
  assert.equal(products.length, 2);
  const serialized = products.find(product => product.id === PROD_S);
  const quantity = products.find(product => product.id === PROD_Q);
  assert.equal(serialized.tracking_mode, 'serialized');
  assert.equal(serialized.availability.available_count, 1);
  assert.equal(quantity.availability.available, '6');
  assert.equal(quantity.availability.physical_stock, '10');
});

test('9. errores RPC críticos se mapean sin filtrar detalles', async () => {
  const cases = [
    ['REQUEST_NOT_FOUND', 404],
    ['REQUEST_LINE_NOT_FOUND', 404],
    ['INVALID_REQUEST_LINES', 400],
    ['DELIVERY_LINES_MISMATCH', 400],
    ['INVALID_DELIVERY_QUANTITY', 400],
    ['INVALID_REQUEST_TRANSITION', 409],
    ['ITEM_ALREADY_RESERVED', 409],
    ['PREPARATION_INCONSISTENT', 409],
    ['INSUFFICIENT_STOCK', 409],
    ['IDEMPOTENCY_PAYLOAD_MISMATCH', 409],
  ];
  for (const [token, status] of cases) {
    const mapped = service.mapOperationsDatabaseError(dbError(`boom ${token} secret`));
    assert.equal(mapped.statusCode, status);
    assert.equal(mapped.message.includes('secret'), false);
  }
  const unknown = service.mapOperationsDatabaseError(new Error('rare failure secret'));
  assert.equal(unknown.statusCode, 503);
  assert.equal(unknown.message.includes('secret'), false);
  state.nextError = dbError('INSUFFICIENT_STOCK');
  await assert.rejects(
    service.deliverMaterialRequest(
      CLIENT_ADMIN, REQ_OWN,
      { deliveries: { [LINE_S]: 1, [LINE_Q]: 1 } },
      '12345678-1234-4234-8234-123456789012',
    ),
    error => error.statusCode === 409 && error.message === 'Stock insuficiente',
  );
});

const CLIENT_OK = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CLIENT_INACTIVE = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CLIENT_LEGACY = 'cccccccc-3333-4333-8333-cccccccccccc';
const CLIENT_MISSING = 'dddddddd-4444-4444-8444-dddddddddddd';

function createBody(overrides = {}) {
  return {
    reason: 'maintenance',
    lines: [{ product_id: PROD_S, requested_quantity: 1 }],
    ...overrides,
  };
}

test('10. planta se normaliza a NULL según motivo; cliente destino se valida sin autorizar', async () => {
  // Motivo con planta: se conserva.
  await service.createMaterialRequest(CLIENT_ADMIN, createBody({ plant_id: PLANT_A }));
  assert.equal(state.calls.at(-1).args.plantId, PLANT_A.toLowerCase());

  // Motivos sin planta: se normaliza a NULL sin error aunque venga stale.
  for (const reason of ['installation', 'internal', 'other']) {
    await service.createMaterialRequest(CLIENT_ADMIN, createBody({ reason, plant_id: PLANT_A }));
    assert.equal(state.calls.at(-1).args.plantId, null);
  }

  // Cliente comercial activo: se propaga al RPC (client_user incluido,
  // sin gate de autorización por cliente).
  const before = state.calls.length;
  await service.createMaterialRequest(
    CLIENT_USER, createBody({ reason: 'installation', destination_client_id: CLIENT_OK }),
  );
  assert.equal(state.calls.length, before + 1);
  assert.equal(state.calls.at(-1).args.destinationClientId, CLIENT_OK);

  // Sin cliente: NULL explícito.
  await service.createMaterialRequest(CLIENT_USER, createBody({ destination: 'Bodega' }));
  assert.equal(state.calls.at(-1).args.destinationClientId, null);

  // Cliente inexistente/inactivo/no comercial: 404 sin llamar al RPC.
  for (const destinationClientId of [CLIENT_MISSING, CLIENT_INACTIVE, CLIENT_LEGACY]) {
    const calls = state.calls.length;
    await assert.rejects(
      service.createMaterialRequest(CLIENT_USER, createBody({ destination_client_id: destinationClientId })),
      error => error.statusCode === 404,
    );
    assert.equal(state.calls.length, calls);
  }

  // UUID inválido: 400.
  await assert.rejects(
    service.createMaterialRequest(CLIENT_USER, createBody({ destination_client_id: 'no-uuid' })),
    error => error.statusCode === 400,
  );

  // Respaldo RPC: INVALID_DESTINATION_CLIENT se mapea a 404 sin detalles.
  const mapped = service.mapOperationsDatabaseError(dbError('boom INVALID_DESTINATION_CLIENT secret'));
  assert.equal(mapped.statusCode, 404);
  assert.equal(mapped.message.includes('secret'), false);
});

test('10b. listado y detalle exponen cliente destino; endpoint solo comerciales activos', async () => {
  const rows = await service.listDestinationClients(CLIENT_USER);
  assert.deepEqual(rows.map(row => row.id), [CLIENT_OK]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['email', 'id', 'name', 'phone']);

  state.requests[0].destination_client_id = CLIENT_OK;
  const listed = await service.listMaterialRequests(CLIENT_ADMIN, {});
  const own = listed.find(row => row.id === REQ_OWN);
  assert.equal(own.destination_client_id, CLIENT_OK);
  assert.equal(own.destination_client.name, 'Cliente Activo');

  const detail = await service.getMaterialRequestDetail(CLIENT_ADMIN, REQ_OWN);
  assert.equal(detail.request.destination_client_id, CLIENT_OK);
  assert.equal(detail.request.destination_client.name, 'Cliente Activo');
});
