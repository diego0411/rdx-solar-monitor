import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, nextTick, ref, watch } from 'vue';
import { inventoryCategoryLabel, inventoryCategoryLabels } from '../src/utils/inventoryCategories.js';

const source = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
const template = source;
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'inventory-operations-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

const OP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROD_Q = '11111111-1111-4111-8111-111111111111';
const PROD_S = '22222222-2222-4222-8222-222222222222';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const calls = [];
let currentRole = 'rdx_admin';
let currentPermissions = ['inventory'];
const products = [
  { id: PROD_Q, name: 'Cable', category: 'cable', unit: 'metro', tracking_mode: 'quantity', active: true },
  { id: PROD_S, name: 'Inversor', category: 'inverter', unit: 'unidad', tracking_mode: 'serialized', active: true },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Viejo', category: 'other', unit: 'u', tracking_mode: 'quantity', active: false },
];
const behaviors = { create: 'ok', confirm: 'ok', cancel: 'ok' };

function apiError(status, detail) {
  const error = new Error(`Error de API: ${status}`);
  error.status = status;
  error.detail = detail;
  return error;
}

const deps = {
  ref, computed, watch, onMounted() {}, onUnmounted() {},
  useModalEscape: () => () => {},
  categories: inventoryCategoryLabels,
  categoryLabel: inventoryCategoryLabel,
  getMyProfile: async () => ({ profile: { role: currentRole, module_permissions: currentPermissions } }),
  listInventoryProducts: async () => products,
  createInventoryProduct: async payload => ({ id: 'new', ...payload }),
  listOperations: async params => {
    calls.push({ fn: 'listOperations', params });
    return [{ id: OP_ID, operation_type: 'IN', status: 'draft', operation_date: '2026-10-04', line_count: 1 }];
  },
  getOperation: async id => {
    calls.push({ fn: 'getOperation', id });
    return { operation: { id, operation_type: 'IN', status: 'draft' }, lines: [] };
  },
  createOperation: async (payload, key) => {
    calls.push({ fn: 'createOperation', payload, key });
    if (behaviors.create !== 'ok') throw behaviors.create;
    return { id: OP_ID, status: 'draft' };
  },
  confirmOperation: async (id, key) => {
    calls.push({ fn: 'confirmOperation', id, key });
    if (behaviors.confirm !== 'ok') throw behaviors.confirm;
    return { id, status: 'confirmed' };
  },
  cancelOperation: async (id, key) => {
    calls.push({ fn: 'cancelOperation', id, key });
    if (behaviors.cancel !== 'ok') throw behaviors.cancel;
    return { id, status: 'cancelled' };
  },
};

function setup() {
  calls.length = 0;
  behaviors.create = 'ok';
  behaviors.confirm = 'ok';
  behaviors.cancel = 'ok';
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return component.setup({}, { expose() {} });
}

function quantityLine(overrides = {}) {
  return { product_id: PROD_Q, quantity: '10', serial_text: '', notes: '', ...overrides };
}

test('pestañas Productos/Movimientos conviven; Productos es inicial', () => {
  assert.match(template, /Productos/);
  assert.match(template, /Movimientos/);
  assert.match(template, /@click="switchTab\('products'\)"/);
  assert.match(template, /@click="switchTab\('movements'\)"/);
  const view = setup();
  assert.equal(view.activeTab.value, 'products');
});

test('listado carga operaciones con filtros y etiquetas ES', async () => {
  const view = setup();
  assert.equal(view.operationTypeLabel('IN'), 'Entrada');
  assert.equal(view.operationTypeLabel('ADJUST_IN'), 'Ajuste +');
  assert.equal(view.operationTypeLabel('ADJUST_OUT'), 'Ajuste −');
  assert.equal(view.operationStatusLabel('draft'), 'Borrador');
  assert.equal(view.operationStatusLabel('confirmed'), 'Confirmado');
  assert.equal(view.operationStatusLabel('cancelled'), 'Cancelado');
  view.opFilters.value = { operationType: 'IN', status: 'draft', dateFrom: '', dateTo: '' };
  await view.loadOperations();
  assert.deepEqual(calls[0], { fn: 'listOperations', params: { operationType: 'IN', status: 'draft' } });
  assert.equal(view.operations.value.length, 1);
  assert.match(template, /Fecha.*Tipo.*Referencia.*Estado/s);
  assert.match(template, /Ver detalle/);
});

test('writer ve Nueva operación; client_user no', () => {
  assert.match(template, /Nueva operación/);
  assert.match(template, /v-if="canWriteOperations"/);
  const admin = setup();
  admin.role.value = 'rdx_admin';
  assert.equal(admin.canWriteOperations.value, true);
  const manager = setup();
  manager.role.value = 'client_admin';
  manager.permissions.value = ['inventory'];
  assert.equal(manager.canWriteOperations.value, true);
  const reader = setup();
  reader.role.value = 'client_user';
  reader.permissions.value = ['inventory'];
  assert.equal(reader.canWriteOperations.value, false);
});

test('formulario multiítem agrega y elimina líneas', () => {
  const view = setup();
  view.openOpCreate();
  assert.equal(view.opForm.value.lines.length, 1);
  view.addOpLine();
  assert.equal(view.opForm.value.lines.length, 2);
  view.removeOpLine(0);
  assert.equal(view.opForm.value.lines.length, 1);
  view.removeOpLine(0);
  assert.equal(view.opForm.value.lines.length, 1);
});

test('producto duplicado bloqueado en selector y en guardado', async () => {
  const view = setup();
  view.products.value = products;
  view.openOpCreate();
  view.opForm.value.lines = [quantityLine(), quantityLine()];
  const eligible = view.eligibleProducts(view.opForm.value.lines[1]);
  assert.ok(!eligible.some(product => product.id === PROD_Q));
  await view.saveDraft();
  assert.equal(view.opFormError.value, 'Una operación no puede repetir el mismo producto.');
  assert.ok(!calls.some(call => call.fn === 'createOperation'));
});

test('serialized en IN muestra seriales y exige N exactos', async () => {
  const view = setup();
  view.products.value = products;
  view.openOpCreate();
  view.opForm.value.lines = [{
    product_id: PROD_S, quantity: '2', serial_text: 'A\nB\n', notes: '',
  }];
  assert.equal(view.lineIsSerialized(view.opForm.value.lines[0]), true);
  assert.equal(view.serialCountText(view.opForm.value.lines[0]), '2 de 2 seriales');
  await view.saveDraft();
  assert.equal(calls.filter(call => call.fn === 'createOperation').length, 1);
  const sent = calls.find(call => call.fn === 'createOperation').payload;
  assert.deepEqual(sent.lines[0].serial_numbers, ['A', 'B']);
  assert.equal(sent.lines[0].quantity, 2);
});

test('cantidad N exige N seriales ni más ni menos', async () => {
  const view = setup();
  view.products.value = products;
  view.openOpCreate();
  view.opForm.value.lines = [{ product_id: PROD_S, quantity: '2', serial_text: 'SOLO-UNO', notes: '' }];
  await view.saveDraft();
  assert.match(view.opFormError.value, /requiere 2 seriales/);
  assert.ok(!calls.some(call => call.fn === 'createOperation'));
});

test('serialized excluido del selector en ADJUST_IN/ADJUST_OUT', () => {
  const view = setup();
  view.products.value = products;
  view.openOpCreate();
  view.opForm.value.operation_type = 'ADJUST_IN';
  const eligible = view.eligibleProducts(view.opForm.value.lines[0]);
  assert.ok(eligible.some(product => product.id === PROD_Q));
  assert.ok(!eligible.some(product => product.id === PROD_S));
  view.opForm.value.operation_type = 'ADJUST_OUT';
  assert.ok(!view.eligibleProducts(view.opForm.value.lines[0]).some(product => product.id === PROD_S));
});

test('cambiar tipo limpia serializados ya elegidos', () => {
  const view = setup();
  view.products.value = products;
  view.openOpCreate();
  view.opForm.value.lines = [{ product_id: PROD_S, quantity: '1', serial_text: 'X', notes: '' }];
  view.opForm.value.operation_type = 'ADJUST_OUT';
  view.onOpTypeChange();
  assert.equal(view.opForm.value.lines[0].product_id, '');
});

test('create guarda borrador sin confirmar automáticamente', async () => {
  const view = setup();
  view.products.value = products;
  view.openOpCreate();
  view.opForm.value.lines = [quantityLine()];
  await view.saveDraft();
  assert.equal(calls.filter(call => call.fn === 'createOperation').length, 1);
  assert.ok(!calls.some(call => call.fn === 'confirmOperation'));
  assert.equal(view.opNotice.value, 'Borrador guardado correctamente.');
  assert.ok(calls.some(call => call.fn === 'getOperation'));
});

test('confirm y cancel llaman su endpoint con id y key', async () => {
  const view = setup();
  view.selectedOp.value = { operation: { id: OP_ID, status: 'draft' }, lines: [] };
  view.showOpDetail.value = true;
  view.askOpAction('confirm');
  assert.match(view.actionKey.value, uuidPattern);
  await view.runOpAction();
  const confirm = calls.find(call => call.fn === 'confirmOperation');
  assert.deepEqual([confirm.id, confirm.key], [OP_ID, view.actionKey.value]);
  view.askOpAction('cancel');
  await view.runOpAction();
  const cancel = calls.find(call => call.fn === 'cancelOperation');
  assert.deepEqual([cancel.id, cancel.key], [OP_ID, view.actionKey.value]);
});

test('doble click con request pendiente no duplica', async () => {
  const view = setup();
  view.products.value = products;
  view.openOpCreate();
  view.opForm.value.lines = [quantityLine()];
  view.opSaving.value = true;
  await view.saveDraft();
  assert.ok(!calls.some(call => call.fn === 'createOperation'));
  view.opSaving.value = false;
  view.selectedOp.value = { operation: { id: OP_ID, status: 'draft' }, lines: [] };
  view.pendingAction.value = 'confirm';
  view.acting.value = true;
  await view.runOpAction();
  assert.ok(!calls.some(call => call.fn === 'confirmOperation'));
});

test('idempotency key estable durante retry lógico del mismo guardado', async () => {
  const view = setup();
  view.products.value = products;
  view.openOpCreate();
  const firstKey = view.draftKey.value;
  assert.match(firstKey, uuidPattern);
  view.opForm.value.lines = [quantityLine()];
  behaviors.create = apiError(409, 'Stock insuficiente');
  await view.saveDraft();
  assert.equal(view.opFormError.value, 'Stock insuficiente');
  behaviors.create = 'ok';
  await view.saveDraft();
  const keys = calls.filter(call => call.fn === 'createOperation').map(call => call.key);
  assert.deepEqual(keys, [firstKey, firstKey]);
});

test('confirm exitoso refresca detalle, lista y catálogo', async () => {
  const view = setup();
  view.products.value = products;
  view.selectedOp.value = { operation: { id: OP_ID, status: 'draft' }, lines: [] };
  view.showOpDetail.value = true;
  view.askOpAction('confirm');
  await view.runOpAction();
  assert.equal(view.opNotice.value, 'Operación confirmada. El inventario fue actualizado.');
  assert.ok(calls.filter(call => call.fn === 'listOperations').length >= 1);
  assert.ok(calls.filter(call => call.fn === 'getOperation').length >= 1);
});

test('errores backend muestran detalle sin stack', async () => {
  const view = setup();
  view.products.value = products;
  view.selectedOp.value = { operation: { id: OP_ID, status: 'draft' }, lines: [] };
  view.showOpDetail.value = true;
  view.askOpAction('confirm');
  behaviors.confirm = apiError(409, 'Stock insuficiente');
  await view.runOpAction();
  assert.equal(view.actionError.value, 'Stock insuficiente');
  assert.equal(view.pendingAction.value, 'confirm');
});

test('diálogo explícito previo a confirmar o cancelar', () => {
  assert.match(template, /actualizará el inventario y no podrá editarse/);
  assert.match(template, /¿Cancelar este borrador\?/);
  const view = setup();
  assert.equal(view.pendingAction.value, null);
  view.askOpAction('cancel');
  assert.equal(view.pendingAction.value, 'cancel');
});

test('detalle solo lectura sin acciones cuando no es draft', () => {
  assert.match(template, /selectedOp\.operation\?\.status === 'draft' && canWriteOperations/);
});
