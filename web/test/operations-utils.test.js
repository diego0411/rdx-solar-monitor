import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildCreatePayload,
  buildDeliveries,
  cancellableStatus,
  eventLabel,
  friendlyOperationsError,
  isIdempotencyKey,
  isPartialDelivery,
  isWarehouseRole,
  canCreateRequest,
  newIdempotencyKey,
  priorityLabel,
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
    'cancelRequest', 'deliverRequest', 'listProducts', 'listAvailableItems']) {
    assert.match(service, new RegExp(`export function ${name}\\(`));
  }
  assert.match(service, /\/operations\/requests/);
  assert.match(service, /\/operations\/products/);
  assert.match(service, /available-items/);
  assert.match(service, /prepared-quantity/);
  assert.match(service, /'Idempotency-Key'/);
  assert.match(service, /target_status/);
});
