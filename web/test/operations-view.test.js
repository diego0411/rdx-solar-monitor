import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed, watch, nextTick } from 'vue';

const { descriptor } = parse(readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8'));
const code = compileScript(descriptor, { id: 'operations-view-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

const PROD_S = '11111111-1111-4111-8111-111111111111';

function setup({
  role = 'client_admin', requests = [], products = [], plants = [], clients = [],
  create = null, pushed = null,
} = {}) {
  const deps = {
    ref, computed, watch, nextTick, onMounted() {}, onUnmounted() {},
    SearchableSelect: {},
    useRouter: () => ({ push: async path => { if (pushed) pushed.paths.push(path); } }),
    getMyProfile: async () => ({ profile: { role } }),
    apiFetch: async () => plants,
    listRequests: async () => requests,
    listProducts: async () => products,
    listClients: async () => clients,
    createRequest: create ?? (async payload => ({ id: 'new-id', code: 'MAT-2026-0001', ...payload })),
    buildCreatePayload: (...args) => globalThis.__buildCreatePayload(...args),
    canCreateRequest: roleToCheck => ['rdx_admin', 'client_admin', 'client_user'].includes(roleToCheck),
    destinationDisplay: (...args) => globalThis.__destinationDisplay(...args),
    destinationTypeLabels: { client: 'Cliente', other: 'Otro' },
    destinationTypes: ['client', 'other'],
    filterPickerProducts: (...args) => globalThis.__filterPickerProducts(...args),
    availableCategoryOptions: (...args) => globalThis.__availableCategoryOptions(...args),
    pickerAvailabilityText: (...args) => globalThis.__pickerAvailabilityText(...args),
    productCategoryLabel: (...args) => globalThis.__productCategoryLabel(...args),
    reasonAllowsPlant: (...args) => globalThis.__reasonAllowsPlant(...args),
    priorityLabel: priority => ({ low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }[priority] ?? priority),
    reasonLabel: reason => reason,
    reasonLabels: { installation: 'InstalaciA3n', maintenance: 'Mantenimiento' },
    requestPriorities: ['low', 'normal', 'high', 'urgent'],
    requestReasons: ['installation', 'maintenance'],
    statusLabel: status => status,
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return component.setup({}, { expose() {} });
}

const { buildCreatePayload, destinationDisplay, reasonAllowsPlant } = await import('../src/utils/operations.js');
globalThis.__buildCreatePayload = buildCreatePayload;
globalThis.__destinationDisplay = destinationDisplay;
globalThis.__reasonAllowsPlant = reasonAllowsPlant;
const pickerUtils = await import('../src/utils/operations.js');
globalThis.__filterPickerProducts = pickerUtils.filterPickerProducts;
globalThis.__availableCategoryOptions = pickerUtils.availableCategoryOptions;
globalThis.__pickerAvailabilityText = pickerUtils.pickerAvailabilityText;
globalThis.__productCategoryLabel = pickerUtils.productCategoryLabel;

function request(overrides = {}) {
  return {
    id: 'r1', code: 'MAT-2026-0001', status: 'requested', reason: 'maintenance',
    priority: 'normal', destination: null, required_at: null, requested_by: 'u1',
    requester: { id: 'u1', display_name: 'Ana' }, plant_id: null, plant: null,
    maintenance_visit_id: null, created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z', line_count: 1,
    ...overrides,
  };
}

test('2. listado renderiza estados y KPIs por grupo', async () => {
  const view = setup({
    requests: [
      request({ id: '1', status: 'requested' }),
      request({ id: '2', status: 'received' }),
      request({ id: '3', status: 'preparing' }),
      request({ id: '4', status: 'ready' }),
      request({ id: '5', status: 'delivered' }),
      request({ id: '6', status: 'cancelled' }),
    ],
  });
  await view.load();
  assert.equal(view.filtered.value.length, 6);
  assert.deepEqual(view.kpis.value, { requested: 2, preparing: 1, ready: 1, delivered: 1 });
  view.statusFilter.value = 'ready';
  assert.equal(view.filtered.value.length, 1);
});

test('2b. la tabla renderiza etiquetas de estado/prioridad/motivo', () => {
  const template = readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8');
  assert.match(template, /statusLabel\(request\.status\)/);
  assert.match(template, /priorityLabel\(request\.priority\)/);
  assert.match(template, /reasonLabel\(request\.reason\)/);
  assert.match(template, /class="status-badge" :class="request\.status"/);
});

test('botón Nueva solicitud visible para los tres roles', async () => {
  for (const role of ['rdx_admin', 'client_admin', 'client_user']) {
    const view = setup({ role });
    await view.load();
    assert.equal(view.canCreate.value, true);
  }
});

test('4. crear envía payload sin requested_by/client_id y navega al detalle', async () => {
  const pushed = { paths: [] };
  let sent = null;
  const view = setup({
    pushed,
    create: async payload => { sent = payload; return { id: 'created-id', code: 'MAT-2026-0002' }; },
  });
  await view.load();
  view.openCreate();
  view.form.value = {
    reason: 'maintenance',
    priority: 'high',
    plant_id: '',
    destination_type: 'other',
    destination_client_id: '',
    destination: 'Bodega',
    required_at: '',
    observations: '',
    lines: [{ product_id: PROD_S, requested_quantity: '2', observations: '' }],
  };
  await view.saveForm();
  assert.ok(sent);
  assert.ok(!('requested_by' in sent));
  assert.ok(!('client_id' in sent));
  assert.equal(sent.lines.length, 1);
  assert.deepEqual(pushed.paths, ['/operations/created-id']);
});

test('producto duplicado se rechaza sin llamar al servicio', async () => {
  let calls = 0;
  const view = setup({ create: async () => { calls += 1; return { id: 'x' }; } });
  await view.load();
  view.openCreate();
  view.form.value.lines = [
    { product_id: PROD_S, requested_quantity: '1', observations: '' },
    { product_id: PROD_S, requested_quantity: '1', observations: '' },
  ];
  await view.saveForm();
  assert.equal(calls, 0);
  assert.match(view.formError.value, /mismo producto/);
});

test('2b2. planta oculta y limpiada al salir de motivos con planta', async () => {
  const template = readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8');
  assert.match(template, /v-if="reasonAllowsPlant\(form\.reason\)"/);
  const view = setup();
  await view.load();
  view.openCreate();
  view.form.value.reason = 'maintenance';
  view.form.value.plant_id = '66666666-6666-4666-8666-666666666666';
  view.form.value.reason = 'installation';
  await nextTick();
  assert.equal(view.form.value.plant_id, '');
});

test('3b. selector cliente carga comerciales y envía destination_client_id', async () => {
  const template = readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8');
  assert.match(template, /listClients/);
  assert.match(template, /Tipo de destino/);
  let sent = null;
  const clients = [{ id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Cliente Activo' }];
  const view = setup({
    clients,
    create: async payload => { sent = payload; return { id: 'created-id' }; },
  });
  await view.load();
  view.openCreate();
  await nextTick();
  assert.deepEqual(view.clientOptions.value, [{
    id: clients[0].id, name: 'Cliente Activo', phone: null, email: null,
  }]);
  view.form.value = {
    reason: 'installation',
    priority: 'normal',
    plant_id: '',
    destination_type: 'client',
    destination_client_id: clients[0].id,
    destination: 'Nave 3',
    required_at: '',
    observations: '',
    lines: [{ product_id: PROD_S, requested_quantity: '1', observations: '' }],
  };
  await view.saveForm();
  assert.equal(sent.destination_client_id, clients[0].id);
  assert.equal(sent.destination, 'Nave 3');
  assert.ok(!('plant_id' in sent));
});

test('selector Cliente usa SearchableSelect y no select nativo', () => {
  const template = readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8');
  assert.match(template, /<SearchableSelect/);
  assert.match(template, /\['name', 'phone', 'email'\]/);
  assert.match(template, /Buscar cliente por nombre, teléfono o correo/);
  assert.doesNotMatch(template, /<select id="request-client"/);
});

test('cambiar Cliente a Otro limpia destination_client_id y cierra sugerencias', async () => {
  const view = setup();
  await view.load();
  view.openCreate();
  let closed = 0;
  view.clientSelect.value = { close: () => { closed += 1; } };
  view.form.value.destination_client_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  view.form.value.destination_type = 'other';
  await nextTick();
  assert.equal(view.form.value.destination_client_id, '');
  assert.equal(closed, 1);
});

test('5b. tipo otro envía texto sin cliente y exige destino', async () => {
  let sent = null;
  const view = setup({ create: async payload => { sent = payload; return { id: 'created-id' }; } });
  await view.load();
  view.openCreate();
  view.form.value = {
    reason: 'internal',
    priority: 'normal',
    plant_id: '',
    destination_type: 'other',
    destination_client_id: '',
    destination: 'Obra externa km 12',
    required_at: '',
    observations: '',
    lines: [{ product_id: PROD_S, requested_quantity: '1', observations: '' }],
  };
  await view.saveForm();
  assert.ok(sent);
  assert.ok(!('destination_client_id' in sent));
  assert.equal(sent.destination, 'Obra externa km 12');

  view.form.value.destination = '';
  await view.saveForm();
  assert.match(view.formError.value, /destino/i);
});

const PICK_PROD_Q = '22222222-2222-4222-8222-222222222222';

function catalog() {
  return [
    {
      id: PROD_S, name: 'Inversor Híbrido 5K', category: 'inverter',
      manufacturer: 'RDX', model: 'INV-5K', tracking_mode: 'serialized',
      unit: 'pza', active: true,
      availability: { available_count: 3, reserved_count: 0, physical_stock: '3' },
    },
    {
      id: PICK_PROD_Q, name: 'Cable Solar 6mm', category: 'cable',
      manufacturer: 'TopCable', model: 'SOL-6', tracking_mode: 'quantity',
      unit: 'm', active: true,
      availability: { available: '42', physical_stock: '42' },
    },
    {
      id: '33333333-3333-4333-8333-333333333333', name: 'Panel Viejo',
      category: 'solar_panel', manufacturer: 'RDX', model: 'PV-1',
      tracking_mode: 'quantity', unit: 'pza', active: false,
      availability: { available: '5', physical_stock: '5' },
    },
  ];
}

test('picker: modal con buscador, filtros y paginación en template', () => {
  const template = readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8');
  assert.match(template, /Seleccionar material/);
  assert.match(template, /Buscar por nombre, fabricante o modelo/);
  assert.doesNotMatch(template, /Buscar por nombre, código/);
  assert.match(template, /<span>Categoría<\/span>/);
  assert.doesNotMatch(template, /pickerTrackingMode/);
  assert.doesNotMatch(template, /<span>Tipo<\/span>/);
  assert.doesNotMatch(template, />Por cantidad</);
  assert.doesNotMatch(template, />Serializado</);
  assert.match(template, /Mostrar más/);
  assert.match(template, /Escribe para buscar un material o utiliza los filtros\./);
  assert.match(template, /Cambiar material/);
  assert.doesNotMatch(template, /<select v-model="line\.product_id"/);
});

test('picker: limita a 10 resultados y permite mostrar más', async () => {
  const manyProducts = Array.from({ length: 12 }, (_, index) => ({
    id: `product-${index}`,
    name: `Cable Solar ${index}`,
    category: 'cable',
    manufacturer: 'TopCable',
    model: `SOL-${index}`,
    tracking_mode: 'quantity',
    active: true,
    availability: { available: '1' },
  }));
  const view = setup({ products: manyProducts });
  await view.load();
  view.openCreate();
  view.openPickerForNew();
  view.pickerSearch.value = 'cable';
  assert.equal(view.pickerResults.value.results.length, 10);
  assert.equal(view.pickerResults.value.total, 12);
  view.showMorePickerResults();
  assert.equal(view.pickerResults.value.results.length, 12);
});

test('picker: agregar abre modal y seleccionar crea la línea', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  assert.deepEqual(view.form.value.lines, []);
  assert.equal(view.showPicker.value, false);
  view.openPickerForNew();
  assert.equal(view.showPicker.value, true);
  assert.equal(view.pickerResults.value.total, 0);
  assert.equal(view.pickerHasCriteria.value, false);
  view.pickerSearch.value = 'inversor';
  assert.equal(view.pickerResults.value.total, 1);
  view.selectPickerProduct(PROD_S);
  assert.equal(view.showPicker.value, false);
  assert.equal(view.form.value.lines.length, 1);
  assert.equal(view.form.value.lines[0].product_id, PROD_S);
  assert.ok(view.productById(PROD_S));
});

test('picker: quantity y serialized crean líneas solicitadas por cantidad', async () => {
  for (const productId of [PROD_S, PICK_PROD_Q]) {
    const view = setup({ products: catalog() });
    await view.load();
    view.openCreate();
    view.openPickerForNew();
    view.selectPickerProduct(productId);
    assert.deepEqual(view.form.value.lines, [{
      product_id: productId,
      requested_quantity: '1',
      observations: '',
    }]);
  }
});

test('picker: cancelar no crea línea vacía', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  view.openPickerForNew();
  assert.equal(view.showPicker.value, true);
  view.closePicker();
  assert.equal(view.showPicker.value, false);
  assert.deepEqual(view.form.value.lines, []);
});

test('9. payload final createRequest permanece compatible', async () => {
  let sent = null;
  const pushed = { paths: [] };
  const clientId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const view = setup({
    pushed,
    products: catalog(),
    clients: [{ id: clientId, name: 'Cliente Activo' }],
    create: async payload => { sent = payload; return { id: 'created-id', code: 'MAT-2026-0001' }; },
  });
  await view.load();
  view.openCreate();
  view.openPickerForNew();
  view.selectPickerProduct(PICK_PROD_Q);
  view.form.value.reason = 'installation';
  view.form.value.destination_type = 'client';
  view.form.value.destination_client_id = clientId;
  view.form.value.destination = 'Nave 3';
  await view.saveForm();
  assert.deepEqual(sent, {
    reason: 'installation',
    priority: 'normal',
    destination_client_id: clientId,
    destination: 'Nave 3',
    lines: [{ product_id: PICK_PROD_Q, requested_quantity: '1' }],
  });
  assert.deepEqual(pushed.paths, ['/operations/created-id']);
});

test('picker: excluye ya agregados e inactivos; filtra y pagina', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  view.form.value.lines = [{ product_id: PROD_S, requested_quantity: '1', observations: '' }];
  view.openPickerForNew();
  view.pickerCategory.value = 'cable';
  const ids = view.pickerResults.value.results.map(product => product.id);
  assert.ok(!ids.includes(PROD_S));
  assert.ok(!ids.some(id => id === '33333333-3333-4333-8333-333333333333'));
  assert.deepEqual(ids, [PICK_PROD_Q]);

  view.pickerSearch.value = 'INVERSOR híbrido';
  assert.equal(view.pickerResults.value.total, 0);
  view.pickerSearch.value = 'cable sol-6';
  assert.equal(view.pickerResults.value.total, 1);

  view.pickerSearch.value = '';
  view.pickerCategory.value = 'all';
  view.pickerCategory.value = 'cable';
  assert.deepEqual(view.pickerResults.value.results.map(product => product.id), [PICK_PROD_Q]);
});

test('picker: cambiar material de una línea existente', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  view.form.value.lines = [{ product_id: PROD_S, requested_quantity: '1', observations: '' }];
  view.openPickerForLine(0);
  view.selectPickerProduct(PICK_PROD_Q);
  assert.equal(view.form.value.lines.length, 1);
  assert.equal(view.form.value.lines[0].product_id, PICK_PROD_Q);
});
