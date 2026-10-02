import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, nextTick, ref, watch } from 'vue';
import { inventoryCategoryLabel, inventoryCategoryLabels } from '../src/utils/inventoryCategories.js';

const source = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'inventory-view-test' }).content
  .replace(/^import[^;]*;$/gm, '').replace('export default', 'return');

function setup({ role = 'rdx_admin', products = [], create = null, listError = null } = {}) {
  const deps = {
    ref, computed, watch, onMounted() {}, onUnmounted() {},
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

function manyProducts(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => product({
    id: `p-${index}`,
    name: `Producto ${index}`,
    ...overrides,
  }));
}

test('zona fija de KPIs/filtros y controles de paginación en template', () => {
  const template = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  assert.match(template, /class="inventory-sticky"/);
  assert.match(template, /position: sticky/);
  assert.match(template, /v-for="product in pagedProducts"/);
  assert.match(template, /Anterior/);
  assert.match(template, /Siguiente/);
  assert.match(template, /\{\{ pageRange \}\}/);
  assert.match(template, /\{\{ pageLabel \}\}/);
});

test('KPIs compactos en una sola fila en desktop sin perder información', () => {
  const template = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  assert.match(template, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  for (const label of ['Productos', 'Disponible', 'Despachado', 'Asignado', 'Instalado', 'Stock físico']) {
    assert.match(template, new RegExp(label));
  }
});

test('paginación: 24 productos muestran 10 en página 1', async () => {
  const view = setup({ products: manyProducts(24) });
  await view.loadProducts();
  assert.equal(view.resultCount.value, 24);
  assert.equal(view.pageCount.value, 3);
  assert.equal(view.pagedProducts.value.length, 10);
  assert.deepEqual(view.pagedProducts.value.map(product => product.id),
    Array.from({ length: 10 }, (_, index) => `p-${index}`));
  assert.equal(view.pageRange.value, '1–10 de 24');
  assert.equal(view.pageLabel.value, 'Página 1 de 3');
});

test('paginación: páginas 2 y 3 muestran 10 y 4 productos', async () => {
  const view = setup({ products: manyProducts(24) });
  await view.loadProducts();
  view.nextPage();
  assert.equal(view.currentPage.value, 2);
  assert.equal(view.pagedProducts.value.length, 10);
  assert.equal(view.pagedProducts.value[0].id, 'p-10');
  assert.equal(view.pageRange.value, '11–20 de 24');
  view.nextPage();
  assert.equal(view.currentPage.value, 3);
  assert.equal(view.pagedProducts.value.length, 4);
  assert.equal(view.pagedProducts.value[0].id, 'p-20');
  assert.equal(view.pageRange.value, '21–24 de 24');
  assert.equal(view.pageLabel.value, 'Página 3 de 3');
});

test('paginación: Anterior/Siguiente respetan los límites', async () => {
  const view = setup({ products: manyProducts(24) });
  await view.loadProducts();
  view.prevPage();
  assert.equal(view.currentPage.value, 1);
  view.nextPage();
  view.nextPage();
  view.nextPage();
  assert.equal(view.currentPage.value, 3);
  const template = readFileSync(new URL('../src/views/InventoryView.vue', import.meta.url), 'utf8');
  assert.match(template, /:disabled="currentPage <= 1"/);
  assert.match(template, /:disabled="currentPage >= pageCount"/);
});

test('paginación: el filtro se aplica sobre el catálogo completo y luego pagina', async () => {
  const view = setup({ products: [
    ...manyProducts(12, { category: 'cable', name: 'Cable solar' }).map((item, index) => ({ ...item, id: `cable-${index}` })),
    ...manyProducts(12, { category: 'inverter', name: 'Inversor' }).map((item, index) => ({ ...item, id: `inverter-${index}` })),
  ] });
  await view.loadProducts();
  assert.equal(view.resultCount.value, 24);
  view.filters.value.category = 'cable';
  await nextTick();
  assert.equal(view.resultCount.value, 12);
  assert.equal(view.pageCount.value, 2);
  assert.equal(view.pagedProducts.value.length, 10);
  assert.ok(view.pagedProducts.value.every(product => product.category === 'cable'));
});

test('paginación: aplicar/cambiar/limpiar filtro vuelve a página 1', async () => {
  const view = setup({ products: manyProducts(24) });
  await view.loadProducts();
  view.nextPage();
  view.nextPage();
  assert.equal(view.currentPage.value, 3);
  view.filters.value.search = 'Producto 1';
  await nextTick();
  assert.equal(view.currentPage.value, 1);
  view.nextPage();
  view.clearFilters();
  assert.equal(view.currentPage.value, 1);
  assert.deepEqual(view.filters.value, { search: '', category: '', trackingMode: '', active: '' });
});

test('paginación: 0 resultados no genera Página 1 de 0', async () => {
  const view = setup({ products: manyProducts(5) });
  await view.loadProducts();
  view.filters.value.search = 'sin-coincidencias';
  await nextTick();
  assert.equal(view.resultCount.value, 0);
  assert.deepEqual(view.pagedProducts.value, []);
  assert.equal(view.pageRange.value, '0 de 0');
  assert.equal(view.pageLabel.value, 'Página 1 de 1');
  assert.doesNotMatch(view.pageLabel.value, /1 de 0/);
});

test('paginación: los KPIs no dependen de la página visible', async () => {
  const view = setup({ products: manyProducts(24, {
    summary: { available: '5', dispatched: '0', assigned: '0', installed: '0', physical_stock: '5' },
  }) });
  await view.loadProducts();
  const firstPage = { ...view.kpis.value };
  assert.deepEqual(firstPage, { products: 24, available: 24, dispatched: 0, assigned: 0, installed: 0, physical: 24 });
  view.nextPage();
  view.nextPage();
  assert.equal(view.currentPage.value, 3);
  assert.deepEqual(view.kpis.value, firstPage);
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
