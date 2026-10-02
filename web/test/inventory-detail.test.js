import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, ref } from 'vue';

const source = readFileSync(new URL('../src/views/InventoryDetailView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'inventory-detail-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

function productDetail(trackingMode = 'serialized') {
  return {
    product: {
      id: '11111111-1111-1111-1111-111111111111', name: 'Equipo', category: 'inverter',
      manufacturer: null, model: null, unit: 'unidad', tracking_mode: trackingMode,
      reorder_level: '0', active: true,
    },
    summary: { available: '1', assigned: '0', installed: '0', sold: '0', written_off: '0', physical_stock: '1' },
  };
}

function setup({
  role = 'rdx_admin', trackingMode = 'serialized', detailError = null, items = [], movements = [],
  transition = null, quantityMovement = null, createItem = null, updateProduct = null,
  listItems = null, listMovements = null,
  clients = [{ id: 'c1', name: 'Cliente', plant_ids: ['pl1'] }],
  plants = [{ id: 'pl1', name: 'Planta 1' }],
  devices = [{ id: 'd1', plant_id: 'pl1', name: 'Inversor 1' }],
} = {}) {
  const route = { params: { id: '11111111-1111-1111-1111-111111111111' } };
  let routeWatcher = null;
  const watchers = [];
  const requestedProducts = [];
  const clientRequests = [];
  const deps = {
    ref, computed, onUnmounted() {},
    watch(sourceFn, callback) {
      const watcher = { sourceFn, callback };
      watchers.push(watcher);
      routeWatcher = watcher;
    },
    useRoute: () => route,
    getMyProfile: async () => ({ profile: { role } }),
    apiFetch: async path => {
      if (path === '/devices') return devices;
      return plants;
    },
    listClients: async options => { clientRequests.push(options); return clients; },
    getInventoryProduct: async id => {
      requestedProducts.push(id);
      if (detailError) throw detailError;
      return productDetail(trackingMode);
    },
    listInventoryItems: listItems ?? (async () => items),
    listInventoryMovements: listMovements ?? (async () => movements),
    createSerializedInventoryItem: createItem ?? (async () => ({})),
    transitionSerializedInventoryItem: transition ?? (async () => ({})),
    createQuantityInventoryMovement: quantityMovement ?? (async () => ({})),
    updateInventoryProduct: updateProduct ?? (async () => ({})),
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({}, { expose() {} });
  view.__route = route;
  view.__routeWatcher = routeWatcher;
  view.__watchers = watchers;
  view.__requestedProducts = requestedProducts;
  view.__clientRequests = clientRequests;
  return view;
}

const assignedItem = {
  id: 'i1', product_id: 'p1', serial_number: 'SN-1', status: 'assigned',
  client_id: 'c1', plant_id: 'pl1', device_id: null, created_at: '2026-09-20T10:00:00.000Z',
};

test('detalle serializado carga unidades, historial y acciones compatibles', async () => {
  const view = setup({ items: [assignedItem], movements: [{ id: 'm1', quantity: '1' }] });
  await view.load();
  assert.equal(view.isSerialized.value, true);
  assert.equal(view.items.value.length, 1);
  assert.equal(view.movements.value.length, 1);
  assert.deepEqual(view.allowedActions, {
    available: ['assign', 'sell', 'write_off'],
    assigned: ['install', 'return', 'sell', 'write_off'],
    installed: ['write_off'], sold: [], written_off: [],
  });
  assert.equal(view.canWrite.value, true);
  assert.equal(view.plantName('pl1'), 'Planta 1');
});

test('acciones administrativas están ocultas por v-if y los flujos no se mezclan', () => {
  assert.match(source, /v-if="canWrite"[^>]*@click="openEdit"/);
  assert.match(source, /v-if="canWrite"[^>]*@click="openNewItem"/);
  assert.match(source, /<th v-if="canWrite">Acciones<\/th>/);
  assert.match(source, /<td v-if="canWrite">/);
  assert.match(source, /v-if="canWrite && !isSerialized"[^>]*@click="openQuantity"/);
  assert.match(source, /<section v-if="isSerialized"/);
});

test('roles cliente son de solo lectura y no consultan clientes ni dispositivos', async () => {
  for (const role of ['client_admin', 'client_user']) {
    const view = setup({ role });
    await view.load();
    assert.equal(view.canWrite.value, false);
    assert.deepEqual(view.clients.value, []);
    assert.deepEqual(view.devices.value, []);
  }
});

test('clientes y plantas son independientes: sin include=plant_ids ni filtrado', async () => {
  const clients = [
    { id: 'client-a', name: 'Cliente A' },
    { id: 'client-b', name: 'Cliente B' },
  ];
  const plants = [
    { id: 'plant-a', name: 'Planta A' },
    { id: 'plant-b', name: 'Planta B' },
  ];
  const view = setup({ clients, plants });
  await view.load();
  assert.equal(view.__clientRequests.length, 1);
  assert.ok(!('includePlantIds' in view.__clientRequests[0]));

  view.transitionForm.value.client_id = 'client-a';
  assert.deepEqual(view.transitionAvailablePlants.value.map(plant => plant.id), ['plant-a', 'plant-b']);
  view.transitionForm.value.client_id = '';
  assert.deepEqual(view.quantityAvailablePlants.value.map(plant => plant.id), ['plant-a', 'plant-b']);
  assert.deepEqual(view.itemAvailablePlants.value.map(plant => plant.id), ['plant-a', 'plant-b']);
});

test('cambiar cliente no limpia planta y viceversa', async () => {
  const view = setup({
    clients: [{ id: 'client-a', name: 'A' }, { id: 'client-b', name: 'B' }],
    plants: [{ id: 'plant-a' }, { id: 'plant-b' }],
  });
  await view.load();

  view.transitionForm.value.plant_id = 'plant-a';
  view.transitionForm.value.client_id = 'client-b';
  assert.equal(view.transitionForm.value.plant_id, 'plant-a');

  view.transitionForm.value.client_id = 'client-a';
  view.transitionForm.value.plant_id = 'plant-b';
  assert.equal(view.transitionForm.value.client_id, 'client-a');

  view.quantityForm.value.plant_id = 'plant-a';
  view.quantityForm.value.client_id = 'client-b';
  assert.equal(view.quantityForm.value.plant_id, 'plant-a');
});

test('selectores de planta independientes sin dependencia de cliente', () => {
  assert.doesNotMatch(source, /plantsForClient/);
  assert.doesNotMatch(source, /!transitionForm\.client_id/);
  assert.doesNotMatch(source, /!quantityForm\.clientId/);
  assert.doesNotMatch(source, /no tiene plantas disponibles/);
  assert.match(source, /Sin cliente/);
  assert.match(source, /Sin planta/);
});

test('transición serializada envía asignación con cliente y planta', async () => {
  let sent = null;
  const view = setup({ items: [assignedItem], transition: async (id, payload) => { sent = { id, payload }; return {}; } });
  await view.load();
  const available = { ...assignedItem, id: 'i2', status: 'available', client_id: null, plant_id: null };
  view.openTransition(available, 'assign');
  view.transitionForm.value.client_id = 'c1';
  view.transitionForm.value.plant_id = 'pl1';
  await view.applyTransition();
  assert.deepEqual(sent, {
    id: 'i2',
    payload: { movement_type: 'assign', notes: null, client_id: 'c1', plant_id: 'pl1' },
  });
  assert.equal(view.transitionItem.value, null);
});

test('assign admite cliente solo o planta solo sin exigir pareja', async () => {
  const calls = [];
  const view = setup({ transition: async (id, payload) => { calls.push(payload); return {}; } });
  await view.load();
  const available = { ...assignedItem, id: 'i2', status: 'available', client_id: null, plant_id: null };

  view.openTransition(available, 'assign');
  view.transitionForm.value.client_id = 'c1';
  await view.applyTransition();
  assert.deepEqual(calls.at(-1), { movement_type: 'assign', notes: null, client_id: 'c1', plant_id: null });

  view.openTransition(available, 'assign');
  view.transitionForm.value.plant_id = 'pl1';
  await view.applyTransition();
  assert.deepEqual(calls.at(-1), { movement_type: 'assign', notes: null, client_id: null, plant_id: 'pl1' });

  view.openTransition(available, 'assign');
  await view.applyTransition();
  assert.match(view.transitionError.value, /cliente o planta/);
  assert.equal(calls.length, 2);
});

test('venta serialized available mantiene contexto opcional y pareja dependiente completa', async () => {
  const calls = [];
  const view = setup({ transition: async (id, payload) => { calls.push(payload); return {}; } });
  await view.load();
  const available = { ...assignedItem, status: 'available', client_id: null, plant_id: null };

  view.openTransition(available, 'sell');
  await view.applyTransition();
  assert.deepEqual(calls.at(-1), { movement_type: 'sell', notes: null });

  view.openTransition(available, 'sell');
  Object.assign(view.transitionForm.value, {
    use_context: true, client_id: 'c1', plant_id: 'pl1',
  });
  await view.applyTransition();
  assert.deepEqual(calls.at(-1), {
    movement_type: 'sell', notes: null, client_id: 'c1', plant_id: 'pl1',
  });
});

test('install serialized conserva planta del item y filtra dispositivo sin reenviar contexto', async () => {
  let sent = null;
  const view = setup({
    plants: [{ id: 'plant-a', name: 'A' }, { id: 'plant-b', name: 'B' }],
    devices: [
      { id: 'device-a', plant_id: 'plant-a', name: 'Equipo A' },
      { id: 'device-b', plant_id: 'plant-b', name: 'Equipo B' },
    ],
    transition: async (id, payload) => { sent = payload; return {}; },
  });
  await view.load();
  view.openTransition({ ...assignedItem, plant_id: 'plant-a' }, 'install');
  assert.deepEqual(view.installDevices.value.map(device => device.id), ['device-a']);
  view.transitionForm.value.device_id = 'device-a';
  await view.applyTransition();
  assert.deepEqual(sent, { movement_type: 'install', notes: null, device_id: 'device-a' });
  assert.equal('client_id' in sent, false);
  assert.equal('plant_id' in sent, false);
});

test('install completa la planta faltante sin cambiar el cliente', async () => {
  const calls = [];
  const view = setup({ transition: async (id, payload) => { calls.push(payload); return {}; } });
  await view.load();
  const clientOnly = { ...assignedItem, id: 'i9', client_id: 'c1', plant_id: null };

  view.openTransition(clientOnly, 'install');
  await view.applyTransition();
  assert.match(view.transitionError.value, /planta de instalación/);
  assert.equal(calls.length, 0);

  view.transitionForm.value.plant_id = 'pl1';
  view.transitionForm.value.device_id = 'd1';
  await view.applyTransition();
  assert.deepEqual(calls.at(-1), { movement_type: 'install', notes: null, plant_id: 'pl1', device_id: 'd1' });
  assert.ok(!('client_id' in calls.at(-1)));
});

test('quantity install exige planta de instalación', async () => {
  const calls = [];
  const view = setup({
    trackingMode: 'quantity',
    quantityMovement: async (id, payload) => { calls.push(payload); return {}; },
  });
  await view.load();
  view.openQuantity();
  Object.assign(view.quantityForm.value, { movement_type: 'install', quantity: '1', client_id: 'c1' });
  await view.saveQuantity();
  assert.match(view.quantityError.value, /planta de instalación/);
  assert.equal(calls.length, 0);

  view.quantityForm.value.plant_id = 'pl1';
  await view.saveQuantity();
  assert.deepEqual(calls.at(-1), {
    movement_type: 'install', quantity: '1', notes: null, client_id: 'c1', plant_id: 'pl1',
  });
});

test('payloads serialized coinciden con cada transición permitida', async () => {
  const calls = [];
  const view = setup({ transition: async (id, payload) => { calls.push({ id, payload }); return {}; } });
  await view.load();
  const cases = [
    ['available', 'sell', {}, { movement_type: 'sell', notes: null }],
    ['available', 'write_off', {}, { movement_type: 'write_off', notes: null }],
    ['assigned', 'install', { device_id: 'd1' }, { movement_type: 'install', notes: null, device_id: 'd1' }],
    ['assigned', 'return', {}, { movement_type: 'return', notes: null }],
    ['assigned', 'sell', {}, { movement_type: 'sell', notes: null }],
    ['assigned', 'write_off', {}, { movement_type: 'write_off', notes: null }],
    ['installed', 'write_off', {}, { movement_type: 'write_off', notes: null }],
  ];
  for (const [status, type, form, expected] of cases) {
    view.openTransition({ ...assignedItem, id: `${status}-${type}`, status }, type);
    Object.assign(view.transitionForm.value, form);
    await view.applyTransition();
    assert.deepEqual(calls.at(-1), { id: `${status}-${type}`, payload: expected });
  }
});

test('movimiento quantity conserva precisión decimal y mapea stock insuficiente', async () => {
  let sent = null;
  const success = setup({
    trackingMode: 'quantity',
    quantityMovement: async (id, payload) => { sent = payload; return {}; },
  });
  await success.load();
  success.openQuantity();
  success.quantityForm.value.movement_type = 'in';
  success.quantityForm.value.quantity = '99999999999999999999.0000001';
  await success.saveQuantity();
  assert.equal(sent.quantity, '99999999999999999999.0000001');
  assert.equal(success.showQuantity.value, false);

  const failing = setup({
    trackingMode: 'quantity',
    quantityMovement: async () => { throw Object.assign(new Error('x'), { status: 409, detail: 'Stock insuficiente' }); },
  });
  await failing.load();
  failing.openQuantity();
  failing.quantityForm.value.movement_type = 'adjust_out';
  failing.quantityForm.value.quantity = '2.5';
  await failing.saveQuantity();
  assert.equal(failing.quantityError.value, 'No hay stock suficiente para realizar este movimiento.');
  assert.equal(failing.showQuantity.value, true);
});

test('formularios quantity envían solo los campos requeridos por operación', async () => {
  const calls = [];
  const view = setup({
    trackingMode: 'quantity',
    quantityMovement: async (id, payload) => { calls.push(payload); return {}; },
  });
  await view.load();
  const cases = [
    ['in', {}, { movement_type: 'in', quantity: '1.25', notes: null }],
    ['adjust_in', {}, { movement_type: 'adjust_in', quantity: '1.25', notes: null }],
    ['adjust_out', {}, { movement_type: 'adjust_out', quantity: '1.25', notes: null }],
    ['assign', { client_id: 'c1', plant_id: 'pl1' }, { movement_type: 'assign', quantity: '1.25', notes: null, client_id: 'c1', plant_id: 'pl1' }],
    ['install', { client_id: 'c1', plant_id: 'pl1' }, { movement_type: 'install', quantity: '1.25', notes: null, client_id: 'c1', plant_id: 'pl1' }],
    ['return', { client_id: 'c1', plant_id: 'pl1' }, { movement_type: 'return', quantity: '1.25', notes: null, client_id: 'c1', plant_id: 'pl1' }],
    ['sell', { source_status: 'available' }, { movement_type: 'sell', quantity: '1.25', notes: null, source_status: 'available' }],
    ['sell', { source_status: 'assigned', client_id: 'c1', plant_id: 'pl1' }, { movement_type: 'sell', quantity: '1.25', notes: null, source_status: 'assigned', client_id: 'c1', plant_id: 'pl1' }],
    ['write_off', { source_status: 'available' }, { movement_type: 'write_off', quantity: '1.25', notes: null, source_status: 'available' }],
    ['write_off', { source_status: 'assigned', client_id: 'c1', plant_id: 'pl1' }, { movement_type: 'write_off', quantity: '1.25', notes: null, source_status: 'assigned', client_id: 'c1', plant_id: 'pl1' }],
    ['write_off', { source_status: 'installed', client_id: 'c1', plant_id: 'pl1' }, { movement_type: 'write_off', quantity: '1.25', notes: null, source_status: 'installed', client_id: 'c1', plant_id: 'pl1' }],
  ];
  for (const [type, form, expected] of cases) {
    view.openQuantity();
    Object.assign(view.quantityForm.value, { movement_type: type, quantity: '1.25', ...form });
    await view.saveQuantity();
    assert.deepEqual(calls.at(-1), expected);
  }
});

test('mensajes de errores conocidos son amigables y el genérico no filtra detalles', () => {
  const view = setup();
  assert.equal(view.actionError({ status: 409, detail: 'Stock insuficiente' }), 'No hay stock suficiente para realizar este movimiento.');
  assert.equal(view.actionError({ status: 409, detail: 'Transición de inventario no permitida' }), 'Transición de inventario no permitida');
  assert.equal(view.actionError({ status: 409, detail: 'El serial ya está registrado' }), 'El serial ya está registrado');
  assert.equal(view.actionError({ status: 404, detail: 'trace interna' }), 'El registro ya no está disponible.');
  assert.equal(view.actionError({ status: 500, detail: 'trace interna' }), 'No se pudo completar la operación. Inténtalo nuevamente.');
});

test('filtro de unidades informa error y evita que una respuesta vieja sobrescriba la nueva', async () => {
  const pending = [];
  let call = 0;
  const view = setup({ listItems: () => {
    call += 1;
    if (call === 1) return Promise.resolve([]);
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  } });
  await view.load();
  view.itemFilters.value.search = 'old';
  const oldRequest = view.loadItems();
  view.itemFilters.value.search = 'new';
  const newRequest = view.loadItems();
  pending[1].resolve([{ id: 'new' }]);
  await newRequest;
  pending[0].resolve([{ id: 'old' }]);
  await oldRequest;
  assert.deepEqual(view.items.value, [{ id: 'new' }]);

  view.itemFilters.value.search = 'error';
  const failed = view.loadItems();
  pending[2].reject(new Error('down'));
  await failed;
  assert.ok(view.itemsError.value);
  assert.equal(view.itemsLoading.value, false);
});

test('fallo de refresh después de write se muestra globalmente sin convertirlo en fallo del write', async () => {
  let movementCalls = 0;
  const view = setup({
    items: [assignedItem],
    listMovements: async () => {
      movementCalls += 1;
      if (movementCalls > 1) throw new Error('refresh down');
      return [];
    },
  });
  await view.load();
  view.openTransition({ ...assignedItem, status: 'available' }, 'write_off');
  await view.applyTransition();
  assert.equal(view.transitionItem.value, null);
  assert.equal(view.notice.value, 'Unidad actualizada correctamente.');
  assert.ok(view.refreshError.value);
  assert.equal(view.transitionError.value, '');
});

test('cambio de route param vuelve a cargar el producto', async () => {
  const view = setup();
  await view.load();
  view.__route.params.id = '22222222-2222-2222-2222-222222222222';
  await view.__routeWatcher.callback();
  assert.deepEqual(view.__requestedProducts, [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
  ]);
});

test('404 y error genérico tienen estados separados', async () => {
  const missing = setup({ detailError: Object.assign(new Error('x'), { status: 404 }) });
  await missing.load();
  assert.equal(missing.notFound.value, true);
  assert.equal(missing.error.value, '');

  const broken = setup({ detailError: new Error('down') });
  await broken.load();
  assert.equal(broken.notFound.value, false);
  assert.ok(broken.error.value);
});

test('detalle muestra Despachado sin acción manual de despacho', () => {
  assert.match(source, /dispatched: 'Despachado'/);
  assert.match(source, /summary\.dispatched/);
  assert.doesNotMatch(source, /dispatch.*Despachar|Despachar.*dispatch/);
});
