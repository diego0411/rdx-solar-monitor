import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const PRODUCT_SERIALIZED = '11111111-1111-4111-8111-111111111111';
const PRODUCT_QUANTITY = '22222222-2222-4222-8222-222222222222';
const PRODUCT_HIDDEN = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLANT_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PLANT_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const ADMIN = { id: '99999999-9999-4999-8999-999999999999', role: 'rdx_admin', client_id: null };
const CLIENT_ADMIN = { id: '88888888-8888-4888-8888-888888888888', role: 'client_admin', client_id: CLIENT_A };
const CLIENT_USER = { id: '77777777-7777-4777-8777-777777777777', role: 'client_user', client_id: CLIENT_A };
const ADMIN_SCOPE = { plantIds: null };
const CLIENT_SCOPE = { plantIds: new Set([PLANT_A]) };

const baseProducts = [
  { id: PRODUCT_SERIALIZED, name: 'Inversor Uno', category: 'inverter', tracking_mode: 'serialized', active: true },
  { id: PRODUCT_QUANTITY, name: 'Cable Solar', category: 'cable', tracking_mode: 'quantity', active: true },
  { id: PRODUCT_HIDDEN, name: 'Bateria RDX', category: 'battery', tracking_mode: 'quantity', active: true },
];

const state = {
  products: [],
  items: [],
  movements: [],
  calls: [],
  nextError: null,
};

function inScope(row, scope) {
  return !scope || scope.plantIds.has(row.plant_id);
}

function maybeThrow() {
  if (state.nextError) {
    const error = state.nextError;
    state.nextError = null;
    throw error;
  }
}

mock.module('../src/repositories/inventory.repository.js', {
  namedExports: {
    async listInventoryProducts(filters = {}) {
      return state.products.filter(product =>
        (!filters.category || product.category === filters.category)
        && (!filters.trackingMode || product.tracking_mode === filters.trackingMode)
        && (filters.active === undefined || filters.active === null || product.active === filters.active));
    },
    async getInventoryProductById(id) {
      return state.products.find(product => product.id === id) ?? null;
    },
    async insertInventoryProduct(values) {
      maybeThrow();
      state.calls.push({ method: 'insertProduct', values });
      return { id: PRODUCT_HIDDEN, ...values, active: true };
    },
    async updateInventoryProduct(id, values) {
      maybeThrow();
      state.calls.push({ method: 'updateProduct', id, values });
      const product = state.products.find(row => row.id === id);
      return product ? { ...product, ...values } : null;
    },
    async listInventoryItems(filters = {}) {
      return state.items.filter(item =>
        inScope(item, filters.scope)
        && (!filters.productId || item.product_id === filters.productId)
        && (!filters.status || item.status === filters.status)
        && (!filters.clientId || item.client_id === filters.clientId)
        && (!filters.plantId || item.plant_id === filters.plantId)
        && (!filters.search || item.serial_number.includes(filters.search)));
    },
    async listInventoryMovements(filters = {}) {
      return state.movements.filter(movement =>
        inScope(movement, filters.scope)
        && (!filters.productId || movement.product_id === filters.productId)
        && (!filters.itemId || movement.item_id === filters.itemId)
        && (!filters.movementType || movement.movement_type === filters.movementType)
        && (!filters.clientId || movement.client_id === filters.clientId)
        && (!filters.plantId || movement.plant_id === filters.plantId));
    },
    async createSerializedInventoryItem(values) {
      maybeThrow();
      state.calls.push({ method: 'createSerializedRpc', values });
      return { id: ITEM_ID, product_id: values.productId, serial_number: values.serialNumber };
    },
    async transitionSerializedInventoryItem(values) {
      maybeThrow();
      state.calls.push({ method: 'transitionSerializedRpc', values });
      return { id: values.itemId, status: 'assigned' };
    },
    async recordQuantityInventoryMovement(values) {
      maybeThrow();
      state.calls.push({ method: 'quantityMovementRpc', values });
      return { id: ITEM_ID, product_id: values.productId, movement_type: values.movementType };
    },
  },
});

const service = await import('../src/services/inventory.service.js');

beforeEach(() => {
  state.products = structuredClone(baseProducts);
  state.items = [
    { id: ITEM_ID, product_id: PRODUCT_SERIALIZED, serial_number: 'RDX-1', status: 'available', client_id: null, plant_id: null },
    { id: '55555555-5555-4555-8555-555555555555', product_id: PRODUCT_SERIALIZED, serial_number: 'RDX-2', status: 'assigned', client_id: CLIENT_A, plant_id: PLANT_A },
    { id: '66666666-6666-4666-8666-666666666666', product_id: PRODUCT_SERIALIZED, serial_number: 'RDX-3', status: 'installed', client_id: CLIENT_B, plant_id: PLANT_B },
  ];
  state.movements = [
    { product_id: PRODUCT_QUANTITY, movement_type: 'assign', quantity: '4', from_status: 'available', to_status: 'assigned', client_id: CLIENT_A, plant_id: PLANT_A },
    { product_id: PRODUCT_QUANTITY, movement_type: 'install', quantity: '1.5', from_status: 'assigned', to_status: 'installed', client_id: CLIENT_A, plant_id: PLANT_A },
    { product_id: PRODUCT_HIDDEN, movement_type: 'in', quantity: '20', from_status: null, to_status: 'available', client_id: null, plant_id: null },
    { product_id: PRODUCT_QUANTITY, movement_type: 'assign', quantity: '2', from_status: 'available', to_status: 'assigned', client_id: CLIENT_B, plant_id: PLANT_B },
  ];
  state.calls = [];
  state.nextError = null;
});

test('proyecta ledger quantity con precisión decimal y todas las operaciones', () => {
  const rows = [
    ['in', '10', null, 'available'],
    ['assign', '4', 'available', 'assigned'],
    ['install', '2', 'assigned', 'installed'],
    ['return', '1', 'assigned', 'available'],
    ['sell', '2', 'available', 'sold'],
    ['write_off', '1', 'installed', 'written_off'],
    ['adjust_in', '0.3', null, 'available'],
    ['adjust_out', '0.1', 'available', null],
  ].map(([movement_type, quantity, from_status, to_status]) => ({
    movement_type, quantity, from_status, to_status,
  }));
  assert.deepEqual(service.projectQuantityLedger(rows), {
    available: '5.2',
    dispatched: '0',
    assigned: '1',
    installed: '1',
    sold: '2',
    written_off: '1',
    physical_stock: '7.2',
  });
});

test('ledger reconoce dispatch de Operations: available 6, dispatched 4, físico 10', () => {
  const rows = [
    { movement_type: 'in', quantity: '10', from_status: null, to_status: 'available' },
    { movement_type: 'dispatch', quantity: '4', from_status: 'available', to_status: 'dispatched' },
  ];
  assert.deepEqual(service.projectQuantityLedger(rows), {
    available: '6',
    dispatched: '4',
    assigned: '0',
    installed: '0',
    sold: '0',
    written_off: '0',
    physical_stock: '10',
  });
});

test('sold y written_off siguen fuera del stock físico con dispatched presente', () => {
  const rows = [
    { movement_type: 'in', quantity: '10', from_status: null, to_status: 'available' },
    { movement_type: 'dispatch', quantity: '3', from_status: 'available', to_status: 'dispatched' },
    { movement_type: 'sell', quantity: '2', from_status: 'available', to_status: 'sold' },
    { movement_type: 'write_off', quantity: '1', from_status: 'available', to_status: 'written_off' },
  ];
  const ledger = service.projectQuantityLedger(rows);
  assert.equal(ledger.available, '4');
  assert.equal(ledger.dispatched, '3');
  assert.equal(ledger.sold, '2');
  assert.equal(ledger.written_off, '1');
  assert.equal(ledger.physical_stock, '7');
});

test('proyección scoped oculta available RDX y rechaza balances negativos', () => {
  assert.deepEqual(service.projectQuantityLedger(state.movements.slice(0, 2), { includeAvailable: false }), {
    available: '0',
    dispatched: '0',
    assigned: '2.5',
    installed: '1.5',
    sold: '0',
    written_off: '0',
    physical_stock: '4',
  });
  assert.throws(
    () => service.projectQuantityLedger([{ quantity: '1', from_status: 'available', to_status: 'assigned' }]),
    error => error.statusCode === 503,
  );
});

test('ledger conserva numeric fuera de Number seguro y exige transporte textual', () => {
  assert.deepEqual(service.projectQuantityLedger([{
    quantity: '9007199254740993.0000000000000001', from_status: null, to_status: 'available',
  }]), {
    available: '9007199254740993.0000000000000001',
    dispatched: '0',
    assigned: '0',
    installed: '0',
    sold: '0',
    written_off: '0',
    physical_stock: '9007199254740993.0000000000000001',
  });
  assert.throws(
    () => service.projectQuantityLedger([{ quantity: 1, from_status: null, to_status: 'available' }]),
    error => error.statusCode === 503,
  );
});

test('rdx_admin lista catálogo global con filtros y summaries', async () => {
  const products = await service.getInventoryProducts(ADMIN, ADMIN_SCOPE, {
    category: 'inverter', search: 'uno', active: 'true',
  });
  assert.equal(products.length, 1);
  assert.equal(products[0].id, PRODUCT_SERIALIZED);
  assert.equal(products[0].summary.available, '1');
  assert.equal(products[0].summary.assigned, '1');
  assert.equal(products[0].summary.physical_stock, '3');
});

test('serialized con dispatched cuenta available 1, dispatched 1 y suma al físico', async () => {
  state.items.push({
    id: '77777777-7777-4777-8777-777777777777', product_id: PRODUCT_SERIALIZED,
    serial_number: 'RDX-4', status: 'dispatched', client_id: null, plant_id: null,
  });
  const products = await service.getInventoryProducts(ADMIN, ADMIN_SCOPE, { search: 'uno' });
  const serialized = products.find(product => product.id === PRODUCT_SERIALIZED);
  assert.equal(serialized.summary.available, '1');
  assert.equal(serialized.summary.dispatched, '1');
  assert.equal(serialized.summary.physical_stock, '4');
});

test('GET products no falla ante dispatch quantity y expone dispatched', async () => {
  state.movements.push(
    { product_id: PRODUCT_QUANTITY, movement_type: 'in', quantity: '10', from_status: null, to_status: 'available', client_id: null, plant_id: null },
    { product_id: PRODUCT_QUANTITY, movement_type: 'dispatch', quantity: '4', from_status: 'available', to_status: 'dispatched', client_id: null, plant_id: null },
  );
  const products = await service.getInventoryProducts(ADMIN, ADMIN_SCOPE, {});
  const quantity = products.find(product => product.id === PRODUCT_QUANTITY);
  assert.equal(quantity.summary.available, '0');
  assert.equal(quantity.summary.dispatched, '4');
  assert.equal(quantity.summary.physical_stock, '10');
});

test('client_admin y client_user solo ven productos y stock de su scope', async () => {
  for (const profile of [CLIENT_ADMIN, CLIENT_USER]) {
    const products = await service.getInventoryProducts(profile, CLIENT_SCOPE, {});
    assert.deepEqual(products.map(product => product.id).sort(), [PRODUCT_QUANTITY, PRODUCT_SERIALIZED].sort());
    const serialized = products.find(product => product.id === PRODUCT_SERIALIZED);
    const quantity = products.find(product => product.id === PRODUCT_QUANTITY);
    assert.equal(serialized.summary.available, '0');
    assert.equal(serialized.summary.assigned, '1');
    assert.equal(quantity.summary.available, '0');
    assert.equal(quantity.summary.assigned, '2.5');
    assert.equal(products.some(product => product.id === PRODUCT_HIDDEN), false);
  }
});

test('crea y edita producto solo como rdx_admin', async () => {
  const created = await service.createInventoryProduct(ADMIN, {
    name: ' Panel ', category: 'solar_panel', manufacturer: 'RDX', model: null,
    unit: 'unidad', tracking_mode: 'serialized', reorder_level: '2.0000000000000001',
  });
  assert.equal(created.name, 'Panel');
  assert.equal(state.calls[0].method, 'insertProduct');
  assert.equal(state.calls[0].values.reorder_level, '2.0000000000000001');
  const patched = await service.patchInventoryProduct(ADMIN, PRODUCT_SERIALIZED, { active: false });
  assert.equal(patched.active, false);
  await assert.rejects(
    service.createInventoryProduct(CLIENT_ADMIN, {
      name: 'X', category: 'other', unit: 'u', tracking_mode: 'quantity', reorder_level: 0,
    }),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.patchInventoryProduct(CLIENT_USER, PRODUCT_SERIALIZED, { active: false }),
    error => error.statusCode === 403,
  );
});

test('valida enums de producto y traduce tracking_mode bloqueado', async () => {
  await assert.rejects(
    service.createInventoryProduct(ADMIN, {
      name: 'X', category: 'bad', unit: 'u', tracking_mode: 'quantity', reorder_level: 0,
    }),
    error => error.statusCode === 400,
  );
  const dbError = new Error('update failed');
  dbError.dbCode = '23514';
  dbError.dbMessage = 'tracking_mode no puede cambiar tras el primer uso del producto';
  state.nextError = dbError;
  await assert.rejects(
    service.patchInventoryProduct(ADMIN, PRODUCT_SERIALIZED, { tracking_mode: 'quantity' }),
    error => error.statusCode === 409 && /tracking_mode/.test(error.message),
  );
});

test('alta serialized y transición llaman las RPC con created_by', async () => {
  await service.createInventoryItem(ADMIN, PRODUCT_SERIALIZED, {
    serial_number: ' ab-123 ', notes: 'Nueva',
  });
  await service.transitionInventoryItem(ADMIN, ITEM_ID, {
    movement_type: 'assign', client_id: CLIENT_A, plant_id: PLANT_A,
  });
  assert.equal(state.calls[0].method, 'createSerializedRpc');
  assert.equal(state.calls[0].values.serialNumber, 'ab-123');
  assert.equal(state.calls[0].values.createdBy, ADMIN.id);
  assert.equal(state.calls[1].method, 'transitionSerializedRpc');
  assert.equal(state.calls[1].values.movementType, 'assign');
  assert.equal(state.calls[1].values.createdBy, ADMIN.id);
});

test('movement quantity llama RPC y valida quantity/source antes del repository', async () => {
  await service.createQuantityMovement(ADMIN, PRODUCT_QUANTITY, {
    movement_type: 'sell', quantity: '1.25', source_status: 'assigned',
    client_id: CLIENT_A, plant_id: PLANT_A,
  });
  assert.equal(state.calls[0].method, 'quantityMovementRpc');
  assert.equal(state.calls[0].values.quantity, '1.25');
  await assert.rejects(
    service.createQuantityMovement(ADMIN, PRODUCT_QUANTITY, { movement_type: 'in', quantity: 0 }),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createQuantityMovement(ADMIN, PRODUCT_QUANTITY, { movement_type: 'in', quantity: 1.25 }),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createQuantityMovement(ADMIN, PRODUCT_QUANTITY, {
      movement_type: 'in', quantity: '1e-20000',
    }),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createQuantityMovement(ADMIN, PRODUCT_QUANTITY, {
      movement_type: 'sell', quantity: 1, source_status: 'sold',
    }),
    error => error.statusCode === 400,
  );
});

test('contexto comercial independiente: cliente o planta solos llegan a la RPC', async () => {
  await service.transitionInventoryItem(ADMIN, ITEM_ID, {
    movement_type: 'assign', client_id: CLIENT_A,
  });
  assert.equal(state.calls.at(-1).method, 'transitionSerializedRpc');
  assert.equal(state.calls.at(-1).values.clientId, CLIENT_A);
  assert.equal(state.calls.at(-1).values.plantId, null);

  await service.transitionInventoryItem(ADMIN, ITEM_ID, {
    movement_type: 'assign', plant_id: PLANT_A,
  });
  assert.equal(state.calls.at(-1).values.clientId, null);
  assert.equal(state.calls.at(-1).values.plantId, PLANT_A);

  await service.createQuantityMovement(ADMIN, PRODUCT_QUANTITY, {
    movement_type: 'assign', quantity: '2', client_id: CLIENT_A,
  });
  assert.equal(state.calls.at(-1).method, 'quantityMovementRpc');
  assert.equal(state.calls.at(-1).values.clientId, CLIENT_A);
  assert.equal(state.calls.at(-1).values.plantId, null);

  await service.createQuantityMovement(ADMIN, PRODUCT_QUANTITY, {
    movement_type: 'assign', quantity: '2', plant_id: PLANT_A,
  });
  assert.equal(state.calls.at(-1).values.clientId, null);
  assert.equal(state.calls.at(-1).values.plantId, PLANT_A);
});

test('client_id o plant_id con formato inválido se rechazan antes de la RPC', async () => {
  const before = state.calls.length;
  await assert.rejects(
    service.transitionInventoryItem(ADMIN, ITEM_ID, { movement_type: 'assign', client_id: 'no-uuid' }),
    error => error.statusCode === 400,
  );
  await assert.rejects(
    service.createQuantityMovement(ADMIN, PRODUCT_QUANTITY, {
      movement_type: 'assign', quantity: '1', plant_id: 'no-uuid',
    }),
    error => error.statusCode === 400,
  );
  assert.equal(state.calls.length, before);
});

test('client roles no ejecutan writes de stock', async () => {
  await assert.rejects(
    service.createInventoryItem(CLIENT_ADMIN, PRODUCT_SERIALIZED, { serial_number: 'X' }),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.transitionInventoryItem(CLIENT_USER, ITEM_ID, { movement_type: 'sell' }),
    error => error.statusCode === 403,
  );
  await assert.rejects(
    service.createQuantityMovement(CLIENT_ADMIN, PRODUCT_QUANTITY, { movement_type: 'in', quantity: 1 }),
    error => error.statusCode === 403,
  );
  assert.equal(state.calls.length, 0);
});

test('mapea errores RPC y serial duplicado sin filtrar detalles', () => {
  const cases = [
    ['PRODUCT_NOT_FOUND', null, 404],
    ['ITEM_NOT_FOUND', null, 404],
    ['INVALID_SERIAL', null, 400],
    ['INVALID_QUANTITY', null, 400],
    ['INVALID_SOURCE_STATUS', null, 400],
    ['INVALID_TRACKING_MODE', null, 409],
    ['INVALID_TRANSITION', null, 409],
    ['INSUFFICIENT_STOCK', null, 409],
    ['INVALID_CLIENT_PLANT', null, 400],
    ['INACTIVE_CLIENT', null, 409],
    ['DEVICE_PLANT_MISMATCH', null, 409],
    ['duplicate key contains secret', '23505', 409],
  ];
  for (const [dbMessage, dbCode, status] of cases) {
    const mapped = service.mapInventoryDatabaseError({ dbMessage, dbCode });
    assert.equal(mapped.statusCode, status);
    assert.equal(mapped.message.includes('secret'), false);
  }
});

test('movimientos e items fuera de planta quedan fuera del scope', async () => {
  const items = await service.getInventoryItems(
    CLIENT_ADMIN, CLIENT_SCOPE, PRODUCT_SERIALIZED, {},
  );
  assert.deepEqual(items.map(item => item.serial_number), ['RDX-2']);
  const movements = await service.getInventoryMovements(CLIENT_USER, CLIENT_SCOPE, {});
  assert.equal(movements.length, 2);
  assert.ok(movements.every(row => row.plant_id === PLANT_A));
  assert.deepEqual(await service.getInventoryMovements(CLIENT_USER, CLIENT_SCOPE, {
    clientId: CLIENT_B,
  }), []);
});

test('cliente comercial no deriva del usuario: otra firma en misma planta sí visible', async () => {
  state.movements.push({
    product_id: PRODUCT_QUANTITY, movement_type: 'assign', quantity: '1',
    from_status: 'available', to_status: 'assigned', client_id: CLIENT_B, plant_id: PLANT_A,
  });
  const movements = await service.getInventoryMovements(CLIENT_USER, CLIENT_SCOPE, {});
  assert.equal(movements.length, 3);
  assert.ok(movements.some(row => row.client_id === CLIENT_B));
});

test('producto e item inexistentes se traducen a 404', async () => {
  await assert.rejects(
    service.getInventoryProduct(ADMIN, ADMIN_SCOPE, '99999999-9999-4999-8999-999999999999'),
    error => error.statusCode === 404,
  );
  state.nextError = Object.assign(new Error('rpc'), { dbMessage: 'ITEM_NOT_FOUND', dbCode: 'P0001' });
  await assert.rejects(
    service.transitionInventoryItem(ADMIN, ITEM_ID, { movement_type: 'sell' }),
    error => error.statusCode === 404,
  );
});
