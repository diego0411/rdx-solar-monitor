import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';
import { compensationValue, creditEstimatedValue } from '../src/utils/economicPresentation.js';

const CRE_ID = '11111111-1111-1111-8111-111111111111';
const PAZ_ID = '22222222-2222-2222-8222-222222222222';

const { descriptor } = parse(readFileSync(new URL('../src/components/PlantEconomics.vue', import.meta.url), 'utf8'));
const script = compileScript(descriptor, { id: 'category-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');
const render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)({
  ...Vue, withDirectives: vnode => vnode,
});

function setup({ distributors = [{ id: CRE_ID, code: 'CRE', name: 'CRE R.L.' }], categories = {} } = {}) {
  const calls = [];
  const deps = { ref: Vue.ref, computed: Vue.computed, watch() {}, onMounted() {},
    compensationValue, creditEstimatedValue,
    getMyProfile: async () => ({}),
    async apiFetch(path, options) {
      calls.push({ path, options });
      if (options) return {};
      if (path === '/plants/catalog/energy-distributors') return distributors;
      const match = path.match(/^\/plants\/catalog\/energy-distributors\/(.+)\/tariff-categories$/);
      if (match) return categories[decodeURIComponent(match[1])] ?? [];
      return [];
    },
  };
  const component = new Function(...Object.keys(deps), script)(...Object.values(deps));
  const props = { plantId: 'plant', selectedDate: '2026-09-24', period: 'day' };
  const view = component.setup(props, { expose() {} });
  view.canManage.value = true;
  function nodes(node, result = []) {
    if (node?.type) result.push(node);
    if (Array.isArray(node?.children)) node.children.forEach(child => nodes(child, result));
    return result;
  }
  return { view, calls, nodes: () => nodes(render(Vue.proxyRefs({ ...props, ...view }), [])) };
}

const labels = view => view.categoryOptions.value.map(option => option.label);

test('1. CRE con categorías muestra solo categorías CRE como CODE — NAME', async () => {
  const { view } = setup({ categories: { [CRE_ID]: [
    { id: 'a', code: 'D-PD-BT', name: 'Domiciliaria / Pequeña Demanda / Baja Tensión' },
  ] } });
  view.newTariff();
  view.distributorChoice.value = 'CRE R.L.';
  await view.loadCategoriesForDistributor();
  assert.deepEqual(labels(view), ['D-PD-BT — Domiciliaria / Pequeña Demanda / Baja Tensión']);
});

test('2. cambio CRE → DELAPAZ cambia la lista', async () => {
  const { view } = setup({
    distributors: [{ id: CRE_ID, code: 'CRE', name: 'CRE R.L.' }, { id: PAZ_ID, code: 'DELAPAZ', name: 'DELAPAZ' }],
    categories: {
      [CRE_ID]: [{ id: 'a', code: 'D-PD-BT', name: 'Domiciliaria' }],
      [PAZ_ID]: [{ id: 'b', code: 'R-BT', name: 'Residencial BT' }],
    },
  });
  view.newTariff();
  view.distributorChoice.value = 'CRE R.L.';
  await view.loadCategoriesForDistributor();
  assert.deepEqual(view.categoryOptions.value.map(option => option.code), ['D-PD-BT']);
  view.distributorChoice.value = 'DELAPAZ';
  await view.loadCategoriesForDistributor();
  assert.deepEqual(view.categoryOptions.value.map(option => option.code), ['R-BT']);
});

test('3. categoría previa incompatible vuelve a No especificada', async () => {
  const { view } = setup({
    distributors: [{ id: CRE_ID, code: 'CRE', name: 'CRE R.L.' }, { id: PAZ_ID, code: 'DELAPAZ', name: 'DELAPAZ' }],
    categories: { [CRE_ID]: [{ id: 'a', code: 'D-PD-BT', name: 'Domiciliaria' }], [PAZ_ID]: [] },
  });
  view.newTariff();
  view.distributorChoice.value = 'CRE R.L.';
  await view.loadCategoriesForDistributor();
  view.categoryChoice.value = 'D-PD-BT';
  view.distributorChoice.value = 'DELAPAZ';
  await view.loadCategoriesForDistributor();
  assert.equal(view.categoryChoice.value, 'none');
  assert.deepEqual(labels(view), []);
});

test('4. distribuidor sin categorías muestra solo No especificada + Otra', async () => {
  const { view, calls } = setup({ categories: {} });
  view.newTariff();
  view.distributorChoice.value = 'CRE R.L.';
  await view.loadCategoriesForDistributor();
  assert.deepEqual(labels(view), []);
  assert.equal(view.categoryChoice.value, 'none');
  Object.assign(view.form.value, { purchase_energy_rate: '0.8', export_compensation_type: 'none' });
  await view.saveTariff();
  const payload = JSON.parse(calls.filter(call => call.options).pop().options.body);
  assert.equal(payload.tariff_category, null);
  assert.equal(payload.distributor, 'CRE R.L.');
});

test('5. Otra categoría conserva el flujo manual', async () => {
  const { view, calls } = setup({ categories: {} });
  view.newTariff();
  view.distributorChoice.value = 'CRE R.L.';
  await view.loadCategoriesForDistributor();
  view.categoryChoice.value = 'other';
  Object.assign(view.form.value, { purchase_energy_rate: '0.8', export_compensation_type: 'none' });
  view.form.value.tariff_category = ' Mi categoría ';
  await view.saveTariff();
  assert.equal(JSON.parse(calls.filter(call => call.options).pop().options.body).tariff_category, 'Mi categoría');
});

test('6. seleccionar categoría de catálogo no modifica tarifas ni compensación', async () => {
  const { view } = setup({ categories: { [CRE_ID]: [
    { id: 'a', code: 'D-PD-BT', name: 'Domiciliaria' },
  ] } });
  view.newTariff();
  view.distributorChoice.value = 'CRE R.L.';
  await view.loadCategoriesForDistributor();
  Object.assign(view.form.value, { purchase_energy_rate: '0.8', export_compensation_type: 'monetary',
    export_energy_rate: '0.4', currency: 'BOB', effective_from: '2026-09-24' });
  view.categoryChoice.value = 'D-PD-BT';
  const payload = view.tariffPayload();
  assert.equal(payload.tariff_category, 'D-PD-BT');
  assert.equal(payload.purchase_energy_rate, 0.8);
  assert.equal(payload.export_energy_rate, 0.4);
  assert.equal(payload.export_compensation_type, 'monetary');
  assert.equal(payload.currency, 'BOB');
  assert.equal(payload.effective_from, '2026-09-24');
});

test('7. formulario existente sigue guardando correctamente con categoría de catálogo', async () => {
  const { view, calls } = setup({ categories: { [CRE_ID]: [
    { id: 'a', code: 'D-PD-BT', name: 'Domiciliaria' },
  ] } });
  view.newTariff();
  view.distributorChoice.value = 'CRE R.L.';
  await view.loadCategoriesForDistributor();
  view.categoryChoice.value = 'D-PD-BT';
  Object.assign(view.form.value, { purchase_energy_rate: '0.8', export_compensation_type: 'none' });
  await view.saveTariff();
  assert.deepEqual(JSON.parse(calls.filter(call => call.options).pop().options.body), {
    distributor: 'CRE R.L.', tariff_category: 'D-PD-BT', currency: 'BOB', purchase_energy_rate: 0.8,
    export_compensation_type: 'none', export_energy_rate: null,
    effective_from: '2026-09-24', effective_to: null,
  });
});
