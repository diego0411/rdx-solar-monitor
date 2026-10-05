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
    productCategoryOptions: globalThis.__productCategoryOptions,
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
globalThis.__productCategoryOptions = pickerUtils.productCategoryOptions;
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

test('quick-add: selector permanente visible sin modal ni "+ Agregar material"', () => {
  const template = readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8');
  assert.match(template, /Buscar material/);
  assert.match(template, /Buscar por nombre\/modelo/);
  assert.match(template, /\+ Agregar/);
  assert.match(template, /Materiales agregados/);
  assert.match(template, /Aún no agregaste materiales/);
  assert.doesNotMatch(template, /showPicker/);
  assert.doesNotMatch(template, /openPickerForNew/);
  assert.doesNotMatch(template, /openPickerForLine/);
  assert.doesNotMatch(template, /\+ Agregar material/);
  assert.doesNotMatch(template, /Cambiar material/);
  assert.doesNotMatch(template, /<select v-model="line\.product_id"/);
});

test('quick-add: cantidad default 1 y estado limpio al abrir', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  assert.equal(view.quickQuantity.value, '1');
  assert.equal(view.quickSelectedId.value, '');
  assert.equal(view.quickSearch.value, '');
  assert.equal(view.quickError.value, '');
});

test('quick-add: buscar filtra por nombre/modelo excluyendo agregados', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  view.quickSearch.value = 'cable';
  assert.equal(view.quickResults.value.total, 1);
  assert.deepEqual(view.quickResults.value.results.map(product => product.id), [PICK_PROD_Q]);
  view.quickSearch.value = '';
  assert.deepEqual(view.quickResults.value, { results: [], total: 0 });
});

test('quick-add: producto activo con stock cero sigue seleccionable', async () => {
  const product = {
    id: PICK_PROD_Q,
    name: 'Batería sin stock',
    category: 'battery',
    tracking_mode: 'quantity',
    active: true,
    availability: { available: '0' },
  };
  const view = setup({ products: [product] });
  await view.load();
  view.openCreate();
  view.quickSearch.value = 'batería';
  assert.deepEqual(view.quickResults.value.results, [product]);
  view.chooseQuickProduct(product.id);
  view.addQuickLine();
  assert.equal(view.form.value.lines[0].product_id, product.id);
});

test('quick-add: agregar crea la línea y resetea selector y cantidad', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  assert.deepEqual(view.form.value.lines, []);
  view.quickSearch.value = 'inversor';
  assert.equal(view.quickResults.value.total, 1);
  view.chooseQuickProduct(PROD_S);
  assert.ok(view.quickSelectedProduct());
  view.quickQuantity.value = '2';
  view.addQuickLine();
  assert.deepEqual(view.form.value.lines, [{
    product_id: PROD_S,
    requested_quantity: '2',
    observations: '',
  }]);
  assert.equal(view.quickSelectedId.value, '');
  assert.equal(view.quickQuantity.value, '1');
  assert.equal(view.quickSearch.value, '');
  assert.ok(view.productById(PROD_S));
});

test('quick-add: segundo material sin paso extra y cantidad default', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  view.quickSearch.value = 'inversor';
  view.chooseQuickProduct(PROD_S);
  view.addQuickLine();
  assert.equal(view.quickQuantity.value, '1');
  view.quickSearch.value = 'cable';
  view.chooseQuickProduct(PICK_PROD_Q);
  view.addQuickLine();
  assert.equal(view.form.value.lines.length, 2);
  assert.deepEqual(view.form.value.lines[1], {
    product_id: PICK_PROD_Q,
    requested_quantity: '1',
    observations: '',
  });
});

test('quick-add: sin selección o cantidad inválida no agrega', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  view.addQuickLine();
  assert.equal(view.quickError.value, 'Selecciona un material del catálogo.');
  assert.deepEqual(view.form.value.lines, []);
  view.quickSearch.value = 'cable';
  view.chooseQuickProduct(PICK_PROD_Q);
  view.quickQuantity.value = '0';
  view.addQuickLine();
  assert.equal(view.quickError.value, 'La cantidad debe ser un número mayor a 0.');
  assert.deepEqual(view.form.value.lines, []);
  view.quickQuantity.value = 'abc';
  view.addQuickLine();
  assert.equal(view.form.value.lines.length, 0);
});

test('quick-add: duplicado rechazado con mensaje sin fusionar', async () => {
  const view = setup({ products: catalog() });
  await view.load();
  view.openCreate();
  view.form.value.lines = [{ product_id: PROD_S, requested_quantity: '1', observations: '' }];
  view.quickSearch.value = 'inversor';
  assert.equal(view.quickResults.value.total, 0);
  view.chooseQuickProduct(PROD_S);
  view.addQuickLine();
  assert.equal(view.quickError.value, 'Este material ya fue agregado.');
  assert.equal(view.form.value.lines.length, 1);
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
  view.quickSearch.value = 'cable';
  view.chooseQuickProduct(PICK_PROD_Q);
  view.addQuickLine();
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

test('quick-add: cantidad y observación editables en lista y eliminar funciona', async () => {
  let sent = null;
  const view = setup({
    products: catalog(),
    create: async payload => { sent = payload; return { id: 'created-id', code: 'MAT-2026-0001' }; },
  });
  await view.load();
  view.openCreate();
  view.quickSearch.value = 'cable';
  view.chooseQuickProduct(PICK_PROD_Q);
  view.addQuickLine();
  view.form.value.lines[0].requested_quantity = '3';
  view.form.value.lines[0].observations = 'Urgente';
  view.form.value.reason = 'maintenance';
  view.form.value.destination_type = 'other';
  view.form.value.destination = 'Bodega';
  await view.saveForm();
  assert.deepEqual(sent.lines, [{
    product_id: PICK_PROD_Q, requested_quantity: '3', observations: 'Urgente',
  }]);
  const view2 = setup({ products: catalog() });
  await view2.load();
  view2.openCreate();
  view2.quickSearch.value = 'cable';
  view2.chooseQuickProduct(PICK_PROD_Q);
  view2.addQuickLine();
  assert.equal(view2.form.value.lines.length, 1);
  view2.removeLine(0);
  assert.deepEqual(view2.form.value.lines, []);
});

test('quick-add: sin materiales el guardado exige agregar uno', async () => {
  let calls = 0;
  const view = setup({ create: async () => { calls += 1; return { id: 'x' }; } });
  await view.load();
  view.openCreate();
  view.form.value.reason = 'maintenance';
  await view.saveForm();
  assert.equal(calls, 0);
  assert.match(view.formError.value, /al menos un material/);
});

test('quick-add: lista compacta con disponibilidad y layout responsive', () => {
  const template = readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8');
  assert.match(template, /class="added-row"/);
  assert.match(template, /v-model="line\.requested_quantity"/);
  assert.match(template, /v-model="line\.observations"/);
  assert.match(template, /@click="removeLine\(index\)"/);
  assert.match(template, /pickerAvailabilityText\(productById\(line\.product_id\)\)/);
  assert.match(template, /La disponibilidad es informativa/);
  assert.match(template, /added-row/);
  assert.match(template, /@media \(max-width: 700px\)/);
});
