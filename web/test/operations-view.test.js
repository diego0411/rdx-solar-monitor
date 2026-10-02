import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';

const { descriptor } = parse(readFileSync(new URL('../src/views/OperationsView.vue', import.meta.url), 'utf8'));
const code = compileScript(descriptor, { id: 'operations-view-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

const PROD_S = '11111111-1111-4111-8111-111111111111';

function setup({
  role = 'client_admin', requests = [], products = [], plants = [],
  create = null, pushed = null,
} = {}) {
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    useRouter: () => ({ push: async path => { if (pushed) pushed.paths.push(path); } }),
    getMyProfile: async () => ({ profile: { role } }),
    apiFetch: async () => plants,
    listRequests: async () => requests,
    listProducts: async () => products,
    createRequest: create ?? (async payload => ({ id: 'new-id', code: 'MAT-2026-0001', ...payload })),
    buildCreatePayload: (...args) => globalThis.__buildCreatePayload(...args),
    canCreateRequest: roleToCheck => ['rdx_admin', 'client_admin', 'client_user'].includes(roleToCheck),
    priorityLabel: priority => ({ low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' }[priority] ?? priority),
    reasonLabel: reason => reason,
    reasonLabels: { installation: 'Instalación', maintenance: 'Mantenimiento' },
    requestPriorities: ['low', 'normal', 'high', 'urgent'],
    requestReasons: ['installation', 'maintenance'],
    statusLabel: status => status,
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return component.setup({}, { expose() {} });
}

const { buildCreatePayload } = await import('../src/utils/operations.js');
globalThis.__buildCreatePayload = buildCreatePayload;

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
