import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, ref } from 'vue';
import { inventoryCategoryLabel, inventoryCategoryLabels } from '../src/utils/inventoryCategories.js';

const source = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'inventory-view-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

function setup({ role = 'rdx_admin', products = [], create = null, listError = null } = {}) {
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    categories: inventoryCategoryLabels,
    categoryLabel: inventoryCategoryLabel,
    getMyProfile: async () => ({ profile: { role } }),
    listInventoryProducts: async () => {
      if (listError) throw listError;
      return products;
    },
    createInventoryProduct: create ?? (async payload => ({ id: 'new', ...payload })),
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  return component.setup({}, { expose() {} });
}

function product(overrides = {}) {
  return {
    id: 'p1', name: 'Inversor', category: 'inverter', manufacturer: 'RDX', model: 'X1',
    unit: 'unidad', tracking_mode: 'serialized', active: true,
    summary: { available: '0', assigned: '0', installed: '0', sold: '0', written_off: '0', physical_stock: '0' },
    ...overrides,
  };
}

test('rutas y navegación exponen Inventario', () => {
  const router = readFileSync(new URL('../src/router/index.js', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../src/layouts/AppLayout.vue', import.meta.url), 'utf8');
  assert.match(router, /path: '\/inventory'/);
  assert.match(router, /path: '\/inventory\/:id'/);
  assert.match(layout, /to="\/inventory"/);
  assert.match(layout, />Inventario</);
});

test('KPIs cuentan productos con saldo sin sumar unidades incompatibles', async () => {
  const view = setup({ products: [
    product({ id: 'a', summary: { available: '100000000000000000000.0001', dispatched: '0', assigned: '0', installed: '0', physical_stock: '100000000000000000000.0001' } }),
    product({ id: 'b', tracking_mode: 'quantity', summary: { available: '2.5', dispatched: '3', assigned: '7', installed: '0.1', physical_stock: '12.6' } }),
  ] });
  await view.loadProducts();
  assert.deepEqual(view.kpis.value, { products: 2, available: 2, dispatched: 1, assigned: 1, installed: 1, physical: 2 });
  assert.equal(view.formatDecimal('100000000000000000000.0001'), '100.000.000.000.000.000.000,0001');
});

test('tabla y KPIs muestran Despachado sin acción manual de despacho', async () => {
  const template = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  assert.match(template, /Despachado/);
  assert.match(template, /summary\?\.dispatched/);
  const view = setup({ products: [
    product({ id: 'a', summary: { available: '1', dispatched: '2', assigned: '0', installed: '0', physical_stock: '3' } }),
  ] });
  await view.loadProducts();
  assert.equal(view.kpis.value.dispatched, 1);
});

test('solo rdx_admin tiene escritura y el alta conserva decimales como string', async () => {
  let sent = null;
  const admin = setup({ create: async payload => { sent = payload; return { id: 'new', ...payload }; } });
  admin.role.value = 'rdx_admin';
  assert.equal(admin.canWrite.value, true);
  admin.openCreate();
  admin.form.value.name = '  Cable solar ';
  admin.form.value.category = 'cable';
  admin.form.value.unit = 'metro';
  admin.form.value.tracking_mode = 'quantity';
  admin.form.value.reorder_level = '12345678901234567890.000001';
  await admin.saveProduct();
  assert.equal(sent.reorder_level, '12345678901234567890.000001');
  assert.equal(sent.name, 'Cable solar');
  assert.equal(admin.showCreate.value, false);

  for (const role of ['client_admin', 'client_user']) {
    const reader = setup();
    reader.role.value = role;
    assert.equal(reader.canWrite.value, false);
  }
});

test('validación y errores mantienen el modal abierto', async () => {
  const invalid = setup();
  invalid.openCreate();
  await invalid.saveProduct();
  assert.equal(invalid.formError.value, 'El nombre es obligatorio.');
  assert.equal(invalid.showCreate.value, true);

  const denied = setup({ create: async () => { throw Object.assign(new Error('x'), { status: 403 }); } });
  denied.openCreate();
  denied.form.value.name = 'Panel';
  await denied.saveProduct();
  assert.equal(denied.formError.value, 'No tienes permiso para crear productos.');
  assert.equal(denied.showCreate.value, true);
});

test('estado vacío y error de carga quedan diferenciados', async () => {
  const empty = setup();
  await empty.loadProducts();
  assert.deepEqual(empty.products.value, []);
  assert.equal(empty.error.value, '');

  const broken = setup({ listError: new Error('down') });
  await broken.loadProducts();
  assert.ok(broken.error.value);
  assert.equal(broken.loading.value, false);
});
