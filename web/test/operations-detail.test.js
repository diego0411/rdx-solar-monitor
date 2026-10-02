import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';

const source = readFileSync(new URL('../src/views/MaterialRequestDetailView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'operations-detail-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

const utils = await import('../src/utils/operations.js');

const REQ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE_S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LINE_Q = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROD_S = '11111111-1111-4111-8111-111111111111';
const PROD_Q = '22222222-2222-4222-8222-222222222222';
const ITEM_A = '33333333-3333-4333-8333-333333333333';

function fixture(status = 'preparing') {
  return {
    request: {
      id: REQ, code: 'MAT-2026-0001', status, reason: 'maintenance', priority: 'high',
      destination: null, required_at: null, requested_by: 'u1',
      requester: { id: 'u1', display_name: 'Ana' }, plant_id: null, plant: null,
      created_at: '2026-02-01T00:00:00.000Z', updated_at: '2026-02-01T00:00:00.000Z',
    },
    lines: [
      {
        id: LINE_S, request_id: REQ, product_id: PROD_S,
        requested_quantity: '2', prepared_quantity: '1', delivered_quantity: '0',
        product: { id: PROD_S, name: 'Inversor', tracking_mode: 'serialized', unit: 'pza' },
      },
      {
        id: LINE_Q, request_id: REQ, product_id: PROD_Q,
        requested_quantity: '5', prepared_quantity: '5', delivered_quantity: '0',
        product: { id: PROD_Q, name: 'Cable', tracking_mode: 'quantity', unit: 'kg' },
      },
    ],
    items: [{
      id: 'mri-1', request_line_id: LINE_S, inventory_item_id: ITEM_A, serial_number: 'SN-1',
      prepared_by: 'admin', prepared_at: '2026-02-02T00:00:00.000Z',
      delivered_at: null, released_at: null,
    }],
    events: [
      {
        id: 'e1', request_id: REQ, event_type: 'requested', actor_id: 'u1',
        metadata: {}, created_at: '2026-02-01T00:00:00.000Z',
      },
    ],
  };
}

function setup({ role = 'client_admin', status = 'preparing', api = {} } = {}) {
  const calls = [];
  const data = fixture(status);
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    useRoute: () => ({ params: { id: REQ } }),
    getMyProfile: async () => ({ profile: { role } }),
    getRequest: api.getRequest ?? (async () => structuredClone(data)),
    transitionRequest: api.transitionRequest ?? (async (id, target, key) => {
      calls.push({ method: 'transition', target, key });
      data.request.status = target === 'received' ? 'received' : target;
      return structuredClone(data.request);
    }),
    prepareSerializedItem: api.prepareSerializedItem ?? (async (requestId, lineId, payload) => {
      calls.push({ method: 'prepare', lineId, payload });
      return { id: lineId };
    }),
    releaseSerializedItem: api.releaseSerializedItem ?? (async () => {
      calls.push({ method: 'release' });
      return { id: LINE_S };
    }),
    setPreparedQuantity: api.setPreparedQuantity ?? (async (requestId, lineId, payload) => {
      calls.push({ method: 'setQuantity', lineId, payload });
      return { id: lineId };
    }),
    cancelRequest: api.cancelRequest ?? (async (id, key) => {
      calls.push({ method: 'cancel', key });
      return { status: 'cancelled' };
    }),
    deliverRequest: api.deliverRequest ?? (async (id, deliveries, key) => {
      calls.push({ method: 'deliver', deliveries, key });
      return { status: 'delivered' };
    }),
    listAvailableItems: api.listAvailableItems ?? (async () => [
      { id: 'a1', serial_number: 'SN-A' },
      { id: 'a2', serial_number: 'SN-B' },
      { id: 'a3', serial_number: 'SN-C' },
    ]),
    ...utils,
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return { view: component.setup({}, { expose() {} }), calls };
}

test('3. client_user no ve controles de almacén, solo cancelar', async () => {
  const { view } = setup({ role: 'client_user' });
  await view.load();
  assert.equal(view.isWarehouse.value, false);
  assert.deepEqual(view.actions.value, []);
  assert.equal(view.showCancel.value, true);
  assert.equal(view.showDeliver.value, false);
  assert.equal(view.canPrepare.value, false);
});

test('acciones warehouse por estado: preparing → Marcar lista; ready → Entregar', async () => {
  const preparing = setup({ status: 'preparing' });
  await preparing.view.load();
  assert.equal(preparing.view.isWarehouse.value, true);
  assert.deepEqual(preparing.view.actions.value.map(action => action.target), ['ready']);
  assert.equal(preparing.view.canPrepare.value, true);
  assert.equal(preparing.view.showDeliver.value, false);

  const ready = setup({ status: 'ready' });
  await ready.view.load();
  assert.deepEqual(ready.view.actions.value, []);
  assert.equal(ready.view.showDeliver.value, true);
  assert.equal(ready.view.canPrepare.value, false);
});

test('5. preparación serialized usa available-items con tope de lo pendiente', async () => {
  const seen = [];
  const { view, calls } = setup({
    listAvailableItems: undefined,
    api: {
      listAvailableItems: async (requestId, lineId) => {
        seen.push([requestId, lineId]);
        return [{ id: 'a1', serial_number: 'SN-A' }, { id: 'a2', serial_number: 'SN-B' }];
      },
    },
  });
  await view.load();
  const line = view.lines.value.find(item => item.id === LINE_S);
  await view.openSerialPicker(line);
  assert.deepEqual(seen, [[REQ, LINE_S]]);
  // Pendiente: 2 - 1 = 1, el segundo toggle no debe agregarse.
  view.toggleSerial('a1');
  view.toggleSerial('a2');
  assert.deepEqual(view.serialSelected.value, ['a1']);
  await view.confirmSerialSelection();
  assert.equal(calls.filter(call => call.method === 'prepare').length, 1);
  assert.deepEqual(calls.at(-1).payload, { inventory_item_id: 'a1' });
});

test('6. quantity preparation registra cantidad sin tocar stock local', async () => {
  const { view, calls } = setup();
  await view.load();
  const line = view.lines.value.find(item => item.id === LINE_Q);
  view.setQuantityDraft(line, '3');
  await view.saveQuantity(line);
  assert.equal(calls.filter(call => call.method === 'setQuantity').length, 1);
  assert.deepEqual(calls.at(-1).payload, { prepared_quantity: 3 });
  // Sin autoridad de escritura de inventario en el componente.
  assert.doesNotMatch(source, /services\/inventory/);
  assert.doesNotMatch(source, /inventory_items|inventory_movements/);
});

test('7. delivery envía TODAS las líneas, incluido 0', async () => {
  const { view, calls } = setup({ status: 'ready' });
  await view.load();
  view.openDeliver();
  assert.deepEqual(view.deliverQuantities.value, { [LINE_S]: '1', [LINE_Q]: '5' });
  view.deliverQuantities.value[LINE_S] = 0;
  await view.confirmDeliver();
  const deliver = calls.find(call => call.method === 'deliver');
  assert.ok(deliver);
  assert.deepEqual(Object.keys(deliver.deliveries).sort(), [LINE_Q, LINE_S].sort());
  assert.equal(deliver.deliveries[LINE_S], 0);
});

test('8. el botón de entrega evita doble submit', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { view, calls } = setup({
    status: 'ready',
    api: { deliverRequest: async (...args) => { calls.push({ method: 'deliver', args }); return gate; } },
  });
  await view.load();
  view.openDeliver();
  const first = view.confirmDeliver();
  const second = view.confirmDeliver();
  release({ status: 'delivered' });
  await Promise.all([first, second]);
  assert.equal(calls.filter(call => call.method === 'deliver').length, 1);
});

test('9. retry conserva la idempotency key; éxito la descarta', async () => {
  const keys = [];
  let attempts = 0;
  const { view, calls } = setup({
    status: 'ready',
    api: {
      deliverRequest: async (id, deliveries, key) => {
        attempts += 1;
        keys.push(key);
        calls.push({ method: 'deliver' });
        if (attempts === 1) throw new TypeError('fetch failed');
        return { status: 'delivered' };
      },
    },
  });
  await view.load();
  view.openDeliver();
  const firstKey = view.deliverKey.value;
  assert.match(firstKey, /^[0-9a-f-]{36}$/i);
  await view.confirmDeliver();
  assert.equal(calls.length, 1);
  // Fallo ambiguo: misma key retenida para reintentar.
  assert.equal(view.deliverKey.value, firstKey);
  assert.equal(view.showDeliverModal.value, true);
  await view.confirmDeliver();
  assert.deepEqual(keys, [firstKey, firstKey]);
  // Respuesta definitiva: key descartada y modal cerrado.
  assert.equal(view.deliverKey.value, null);
  assert.equal(view.showDeliverModal.value, false);
});

test('marcar lista con preparación inconsistente muestra mensaje §18', async () => {
  const { view } = setup({
    api: {
      transitionRequest: async () => {
        const error = new Error('Error de API: 409');
        error.status = 409;
        error.body = { error: 'Preparación inconsistente' };
        error.detail = 'Preparación inconsistente';
        throw error;
      },
    },
  });
  await view.load();
  view.askTransition({ target: 'ready', label: 'Marcar lista' });
  await view.confirmTransition();
  assert.equal(
    view.transitionError.value,
    'Revisa la preparación de los materiales antes de marcar la solicitud como lista.',
  );
});

test('timeline traduce eventos sin JSON crudo', () => {
  assert.match(source, /eventLabel\(event\.event_type\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(event/);
  assert.equal(utils.eventLabel('cancelled'), 'Solicitud cancelada');
  assert.equal(utils.eventLabel('rejected'), 'Solicitud rechazada');
});

test('1. menú y router operations bajo permiso operations', () => {
  const layout = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
  const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8');
  assert.match(layout, /v-if="canSee\('operations'\)"/);
  assert.match(layout, /to="\/operations"/);
  assert.match(router, /path: '\/operations'/);
  assert.match(router, /path: '\/operations\/:id'/);
  assert.match(router, /operations: 'operations'/);
  assert.match(router, /'operations-detail': 'operations'/);
});

test('8. detalle muestra cliente destino y referencia sin inferir desde planta', async () => {
  assert.match(source, /Cliente destino/);
  assert.match(source, /Destino \/ referencia/);
  assert.doesNotMatch(source, /client_plants/);
  const data = fixture();
  data.request.destination_client_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  data.request.destination_client = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Cliente Activo' };
  data.request.destination = 'Nave 3';
  const { view } = setup({ api: { getRequest: async () => structuredClone(data) } });
  await view.load();
  assert.equal(view.destinationInfo.value.clientName, 'Cliente Activo');
  assert.equal(view.destinationInfo.value.reference, 'Nave 3');

  const plain = setup();
  await plain.view.load();
  assert.equal(plain.view.destinationInfo.value.clientName, null);
  assert.equal(plain.view.destinationInfo.value.reference, null);
});
