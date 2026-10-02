import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRODUCT_PICKER_PAGE_SIZE,
  buildCreatePayload,
  buildDeliveries,
  cancellableStatus,
  destinationDisplay,
  destinationTypeLabel,
  eventLabel,
  filterPickerProducts,
  friendlyOperationsError,
  isIdempotencyKey,
  isPartialDelivery,
  isWarehouseRole,
  canCreateRequest,
  newIdempotencyKey,
  pickerAvailabilityText,
  priorityLabel,
  productCategoryLabel,
  productCategoryOptions,
  productMatchesSearch,
  reasonAllowsPlant,
  reasonLabel,
  statusLabel,
  transitionActions,
} from '../src/utils/operations.js';

const PROD_S = '11111111-1111-4111-8111-111111111111';
const PROD_Q = '22222222-2222-4222-8222-222222222222';
const LINE_S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LINE_Q = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('etiquetas ES para estados, prioridades, motivos y eventos', () => {
  assert.equal(statusLabel('requested'), 'Solicitada');
  assert.equal(statusLabel('received'), 'Recibida');
  assert.equal(statusLabel('preparing'), 'En preparación');
  assert.equal(statusLabel('ready'), 'Lista para entrega');
  assert.equal(statusLabel('delivered'), 'Entregada');
  assert.equal(statusLabel('rejected'), 'Rechazada');
  assert.equal(statusLabel('cancelled'), 'Cancelada');
  assert.equal(priorityLabel('low'), 'Baja');
  assert.equal(priorityLabel('urgent'), 'Urgente');
  assert.equal(reasonLabel('installation'), 'Instalación');
  assert.equal(reasonLabel('maintenance'), 'Mantenimiento');
  assert.equal(reasonLabel('warranty'), 'Garantía');
  assert.equal(reasonLabel('replacement'), 'Reemplazo');
  assert.equal(reasonLabel('internal'), 'Uso interno');
  assert.equal(reasonLabel('other'), 'Otro');
  assert.equal(eventLabel('requested'), 'Solicitud creada');
  assert.equal(eventLabel('preparing_started'), 'Preparación iniciada');
  assert.equal(eventLabel('item_prepared'), 'Material preparado');
  assert.equal(eventLabel('delivered'), 'Materiales entregados');
});

test('roles: warehouse y creación por rol', () => {
  assert.equal(isWarehouseRole('rdx_admin'), true);
  assert.equal(isWarehouseRole('client_admin'), true);
  assert.equal(isWarehouseRole('client_user'), false);
  assert.equal(canCreateRequest('rdx_admin'), true);
  assert.equal(canCreateRequest('client_admin'), true);
  assert.equal(canCreateRequest('client_user'), true);
  assert.equal(canCreateRequest('unknown'), false);
});

test('acciones de transición por estado', () => {
  assert.deepEqual(transitionActions('requested').map(action => action.target), ['received', 'rejected']);
  assert.deepEqual(transitionActions('received').map(action => action.target), ['preparing']);
  assert.deepEqual(transitionActions('preparing').map(action => action.target), ['ready']);
  assert.deepEqual(transitionActions('ready'), []);
  assert.deepEqual(transitionActions('delivered'), []);
  assert.equal(cancellableStatus('requested'), true);
  assert.equal(cancellableStatus('ready'), true);
  assert.equal(cancellableStatus('delivered'), false);
  assert.equal(cancellableStatus('cancelled'), false);
});

test('idempotency keys con formato UUID', () => {
  const first = newIdempotencyKey();
  const second = newIdempotencyKey();
  assert.equal(isIdempotencyKey(first), true);
  assert.equal(isIdempotencyKey(second), true);
  assert.notEqual(first, second);
  assert.equal(isIdempotencyKey('no-uuid'), false);
});

test('4. payload de creación sin requested_by ni client_id', () => {
  const { payload, error } = buildCreatePayload({
    reason: 'maintenance',
    priority: 'high',
    plant_id: '',
    destination_type: 'other',
    destination: 'Bodega norte',
    required_at: '2026-03-01T10:00:00.000Z',
    observations: 'Urgente',
    requested_by: 'evil-id',
    client_id: 'evil-client',
    lines: [
      { product_id: PROD_S, requested_quantity: '2', observations: '' },
      { product_id: PROD_Q, requested_quantity: 5 },
    ],
  });
  assert.equal(error, undefined);
  assert.ok(!('requested_by' in payload));
  assert.ok(!('client_id' in payload));
  assert.ok(!('plant_id' in payload));
  assert.equal(payload.lines.length, 2);
  assert.equal(payload.destination, 'Bodega norte');

  assert.ok(buildCreatePayload({ reason: 'bad', priority: 'normal', lines: [{ product_id: PROD_S, requested_quantity: 1 }] }).error);
  assert.ok(buildCreatePayload({ reason: 'other', priority: 'normal', lines: [] }).error);
  assert.ok(buildCreatePayload({
    reason: 'other', priority: 'normal',
    lines: [{ product_id: PROD_S, requested_quantity: 0 }],
  }).error);
  assert.ok(buildCreatePayload({
    reason: 'other', priority: 'normal',
    lines: [
      { product_id: PROD_S, requested_quantity: 1 },
      { product_id: PROD_S.toUpperCase(), requested_quantity: 1 },
    ],
  }).error);
});

test('7. delivery incluye TODAS las líneas, incluso con 0', () => {
  const lines = [
    { id: LINE_S, requested_quantity: '2', prepared_quantity: '1' },
    { id: LINE_Q, requested_quantity: '5', prepared_quantity: '5' },
  ];
  const { deliveries, error } = buildDeliveries(lines, { [LINE_S]: 0, [LINE_Q]: '5' });
  assert.equal(error, undefined);
  assert.deepEqual(Object.keys(deliveries).sort(), [LINE_Q, LINE_S].sort());
  assert.equal(deliveries[LINE_S], 0);
  // Ausencia equivale a 0 explícito, nunca a omisión.
  const implicit = buildDeliveries(lines, { [LINE_Q]: 2 });
  assert.equal(implicit.deliveries[LINE_S], 0);
  assert.ok(buildDeliveries(lines, { [LINE_S]: 2, [LINE_Q]: 1 }).error);
  assert.equal(isPartialDelivery(lines, deliveries), true);
  assert.equal(isPartialDelivery(lines, { [LINE_S]: 2, [LINE_Q]: 5 }), false);
});

test('10. errores críticos tienen mensaje amigable', () => {
  const failure = message => ({ status: 409, body: { error: message }, detail: message });
  assert.equal(
    friendlyOperationsError(failure('El serial ya está reservado')),
    'Este equipo ya está preparado en otra solicitud.',
  );
  assert.equal(
    friendlyOperationsError(failure('Stock insuficiente')),
    'No existe stock suficiente para completar la entrega.',
  );
  assert.equal(
    friendlyOperationsError(failure('Preparación inconsistente')),
    'La preparación de materiales está incompleta o es inconsistente.',
  );
  assert.equal(
    friendlyOperationsError({ status: 400, body: { error: 'Las entregas deben incluir todas las líneas' } }),
    'La información de entrega no coincide con los materiales de la solicitud.',
  );
  assert.equal(
    friendlyOperationsError(failure('La clave de idempotencia no coincide con el payload')),
    'Esta acción ya fue registrada con otros datos. Se actualizó el detalle; revísalo antes de reintentar.',
  );
  assert.equal(friendlyOperationsError({ status: 403 }), 'No tienes permiso para realizar esta acción.');
  assert.equal(friendlyOperationsError({ status: 404 }), 'La solicitud ya no está disponible.');
  assert.equal(
    friendlyOperationsError(new TypeError('fetch failed')),
    'No se pudo completar la acción. Comprueba la conexión y vuelve a intentarlo.',
  );
});

test('servicio expone el contrato /api/operations con Idempotency-Key', () => {
  const service = readFileSync(new URL('../src/services/operations.js', import.meta.url), 'utf8');
  for (const name of ['listRequests', 'getRequest', 'createRequest', 'transitionRequest',
    'prepareSerializedItem', 'releaseSerializedItem', 'setPreparedQuantity',
    'cancelRequest', 'deliverRequest', 'listProducts', 'listAvailableItems', 'listClients']) {
    assert.match(service, new RegExp(`export function ${name}\\(`));
  }
  assert.match(service, /\/operations\/requests/);
  assert.match(service, /\/operations\/products/);
  assert.match(service, /\/operations\/clients/);
  assert.match(service, /available-items/);
  assert.match(service, /prepared-quantity/);
  assert.match(service, /'Idempotency-Key'/);
  assert.match(service, /target_status/);
});

const CLIENT_OK = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

function baseForm(overrides = {}) {
  return {
    reason: 'maintenance',
    priority: 'normal',
    plant_id: '',
    destination_type: 'client',
    destination_client_id: CLIENT_OK,
    destination: '',
    required_at: '',
    observations: '',
    lines: [{ product_id: PROD_S, requested_quantity: 1 }],
    ...overrides,
  };
}

test('1. planta visible solo para maintenance/warranty/replacement', () => {
  assert.equal(reasonAllowsPlant('maintenance'), true);
  assert.equal(reasonAllowsPlant('warranty'), true);
  assert.equal(reasonAllowsPlant('replacement'), true);
  assert.equal(reasonAllowsPlant('installation'), false);
  assert.equal(reasonAllowsPlant('internal'), false);
  assert.equal(reasonAllowsPlant('other'), false);
  assert.equal(reasonAllowsPlant('bad'), false);
});

test('2. planta se omite para installation/internal/other aunque venga valor', () => {
  for (const reason of ['installation', 'internal', 'other']) {
    const { payload, error } = buildCreatePayload(baseForm({ reason, plant_id: '66666666-6666-4666-8666-666666666666' }));
    assert.equal(error, undefined);
    assert.ok(!('plant_id' in payload));
  }
  const { payload } = buildCreatePayload(baseForm({ plant_id: '66666666-6666-4666-8666-666666666666' }));
  assert.equal(payload.plant_id, '66666666-6666-4666-8666-666666666666');
});

test('4. cliente seleccionado envía destination_client_id con referencia opcional', () => {
  const { payload, error } = buildCreatePayload(baseForm({ destination: 'Nave 3' }));
  assert.equal(error, undefined);
  assert.equal(payload.destination_client_id, CLIENT_OK);
  assert.equal(payload.destination, 'Nave 3');
  const bare = buildCreatePayload(baseForm());
  assert.equal(bare.error, undefined);
  assert.equal(bare.payload.destination_client_id, CLIENT_OK);
  assert.ok(!('destination' in bare.payload));

  // Sin cliente: error sin llamar al servicio.
  assert.ok(buildCreatePayload(baseForm({ destination_client_id: '' })).error);
  assert.ok(buildCreatePayload(baseForm({ destination_client_id: 'no-uuid' })).error);
  assert.ok(buildCreatePayload(baseForm({ destination_type: 'weird' })).error);
});

test('5. otro envía destination_client_id ausente + destination texto requerido', () => {
  const { payload, error } = buildCreatePayload(baseForm({
    destination_type: 'other',
    destination_client_id: '',
    destination: 'Obra externa km 12',
  }));
  assert.equal(error, undefined);
  assert.ok(!('destination_client_id' in payload));
  assert.equal(payload.destination, 'Obra externa km 12');

  assert.ok(buildCreatePayload(baseForm({ destination_type: 'other', destination: '' })).error);
  assert.ok(buildCreatePayload(baseForm({ destination_type: 'other', destination: '   ' })).error);
});

test('8. listado y detalle muestran cliente destino sin inferir desde planta', () => {
  assert.equal(destinationTypeLabel('client'), 'Cliente');
  assert.equal(destinationTypeLabel('other'), 'Otro');
  const both = destinationDisplay({
    destination_client: { id: CLIENT_OK, name: 'Cliente Activo' },
    destination: 'Nave 3',
    plant_id: '66666666-6666-4666-8666-666666666666',
  });
  assert.equal(both.clientName, 'Cliente Activo');
  assert.equal(both.reference, 'Nave 3');
  assert.equal(both.primary, 'Cliente Activo');
  assert.equal(both.secondary, 'Nave 3');
  const free = destinationDisplay({ destination_client: null, destination: 'Obra externa' });
  assert.equal(free.clientName, null);
  assert.equal(free.primary, 'Obra externa');
  assert.equal(free.secondary, null);
  const empty = destinationDisplay({ destination_client: null, destination: null });
  assert.equal(empty.primary, '—');
});

const PICK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PICK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PICK_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function pickCatalog() {
  return [
    {
      id: PICK_A, name: 'Inversor Híbrido 5K', category: 'inverter',
      manufacturer: 'RDX Tech', model: 'INV-5K', tracking_mode: 'serialized',
      unit: 'pza', active: true,
      availability: { available_count: 3, reserved_count: 1, physical_stock: '4' },
    },
    {
      id: PICK_B, name: 'Cable Solar 6mm', category: 'cable',
      manufacturer: 'TopCable', model: 'SOL-6', tracking_mode: 'quantity',
      unit: 'm', active: true,
      availability: { available: '42', physical_stock: '42' },
    },
    {
      id: PICK_C, name: 'Panel Viejo', category: 'solar_panel',
      manufacturer: 'RDX Tech', model: 'PV-1', tracking_mode: 'quantity',
      unit: 'pza', active: false,
      availability: { available: '5', physical_stock: '5' },
    },
  ];
}

test('picker: búsqueda case-insensitive por nombre, fabricante o modelo', () => {
  const [inverter, cable] = pickCatalog();
  assert.equal(productMatchesSearch(inverter, ''), true);
  assert.equal(productMatchesSearch(inverter, 'inversor'), true);
  assert.equal(productMatchesSearch(inverter, 'INVERSOR HÍBRIDO'), true);
  assert.equal(productMatchesSearch(inverter, 'rdx inv-5k'), true);
  assert.equal(productMatchesSearch(inverter, 'topcable'), false);
  assert.equal(productMatchesSearch(cable, 'CABLE sol-6'), true);
  assert.equal(productMatchesSearch(cable, 'cable panel'), false);
});

test('picker: categorías reales y disponibilidad uniforme', () => {
  assert.equal(productCategoryOptions.length, 9);
  assert.equal(productCategoryLabel('inverter'), 'Inversor');
  const [inverter, cable] = pickCatalog();
  assert.equal(pickerAvailabilityText(inverter), 'Disponible: 3');
  assert.equal(pickerAvailabilityText(cable), 'Disponible: 42');
  assert.equal(pickerAvailabilityText({}), 'Disponibilidad no disponible');
});

test('picker: filtra inactivos/duplicados y pagina sin render masivo', () => {
  const big = Array.from({ length: 45 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: `Producto ${index}`, category: 'other', tracking_mode: 'quantity',
    unit: 'pza', active: true, availability: { available: '1', physical_stock: '1' },
  }));
  const all = [...pickCatalog(), ...big];
  const first = filterPickerProducts(all, { excludeIds: [PICK_A] });
  assert.equal(first.total, 46);
  assert.equal(first.results.length, PRODUCT_PICKER_PAGE_SIZE);
  assert.ok(first.results.every(product => product.active !== false));
  assert.ok(!first.results.some(product => product.id === PICK_A));
  const more = filterPickerProducts(all, { excludeIds: [PICK_A], limit: 40 });
  assert.equal(more.results.length, 40);
  const allShown = filterPickerProducts(all, { excludeIds: [PICK_A], limit: 100 });
  assert.equal(allShown.results.length, 46);

  const byCategory = filterPickerProducts(all, { category: 'cable' });
  assert.deepEqual(byCategory.results.map(product => product.id), [PICK_B]);
  const bySearch = filterPickerProducts(all, { search: 'topcable' });
  assert.deepEqual(bySearch.results.map(product => product.id), [PICK_B]);
});

test('picker: quantity y serialized aparecen juntos por búsqueda y categoría', () => {
  const [serialized, quantity] = pickCatalog();
  const products = [
    { ...serialized, name: 'Kit Solar Serial', category: 'other' },
    { ...quantity, name: 'Kit Solar Cantidad', category: 'other' },
  ];
  const matched = filterPickerProducts(products, { search: 'kit solar', category: 'other' });
  assert.deepEqual(matched.results.map(product => product.id), [PICK_A, PICK_B]);
});

test('categorías Inventory y Operations reutilizan una única fuente canónica', () => {
  const canonical = readFileSync(new URL('../src/utils/inventoryCategories.js', import.meta.url), 'utf8');
  const inventory = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../src/views/InventoryDetailView.vue', import.meta.url), 'utf8');
  const operations = readFileSync(new URL('../src/utils/operations.js', import.meta.url), 'utf8');
  assert.match(canonical, /solar_panel: 'Panel solar'/);
  for (const consumer of [inventory, detail, operations]) {
    assert.match(consumer, /inventoryCategories\.js/);
    assert.doesNotMatch(consumer, /solar_panel:\s*'Panel solar'/);
  }
});
