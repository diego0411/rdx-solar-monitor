import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { compile } from '@vue/compiler-dom';
import * as Vue from 'vue';
import { compensationValue, creditEstimatedValue, shouldShowExportValue } from '../src/utils/economicPresentation.js';

const { descriptor } = parse(readFileSync(new URL('../src/components/PlantEconomics.vue', import.meta.url), 'utf8'));
const script = compileScript(descriptor, { id: 'tariff-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');
const render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)({
  ...Vue, withDirectives: vnode => vnode,
});
function setup() {
  const calls = [];
  const deps = { ref: Vue.ref, computed: Vue.computed, watch() {}, onMounted() {},
    compensationValue, creditEstimatedValue, shouldShowExportValue,
    getMyProfile: async () => ({}),
    async apiFetch(path, options) { calls.push({ path, options }); return options ? {} : []; },
  };
  const component = new Function(...Object.keys(deps), script)(...Object.values(deps));
  const props = { plantId: 'plant', selectedDate: '2026-09-24', period: 'day' };
  const view = component.setup(props, { expose() {} });
  view.canManage.value = true;
  view.newTariff();
  function nodes(node, result = []) {
    if (node?.type) result.push(node);
    if (Array.isArray(node?.children)) node.children.forEach(child => nodes(child, result));
    return result;
  }
  return { view, calls, nodes: () => nodes(render(Vue.proxyRefs({ ...props, ...view }), [])) };
}

test('Bolivian distributors force BOB without prefilling any price; API payload stays compatible', async () => {
  const { view, calls } = setup();
  assert.equal(view.form.value.purchase_energy_rate, '');
  for (const distributor of view.distributors) {
    view.form.value.currency = 'USD';
    view.distributorChoice.value = distributor;
    assert.equal(view.currency.value, 'BOB');
    assert.equal(view.rateUnit.value, 'Bs/kWh');
  }
  view.distributorChoice.value = 'CRE R.L.';
  view.form.value.purchase_energy_rate = '0';
  view.form.value.export_energy_rate = '99';
  view.form.value.effective_to = '2027-01-01';
  await view.saveTariff();
  const writes = calls.filter(call => call.options);
  assert.equal(writes[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(writes[0].options.body), {
    distributor: 'CRE R.L.', tariff_category: null, currency: 'BOB', purchase_energy_rate: 0,
    export_compensation_type: 'none', export_energy_rate: null,
    effective_from: '2026-09-24', effective_to: null,
  });
});

test('Other accepts custom distributor/category/currency and monetary export price', async () => {
  const { view, calls } = setup();
  view.distributorChoice.value = 'other';
  view.categoryChoice.value = 'other';
  Object.assign(view.form.value, { distributor: ' Custom distributor ', tariff_category: ' Custom category ',
    currency: 'EUR', purchase_energy_rate: '0.25', export_compensation_type: 'monetary', export_energy_rate: '0.1' });
  view.hasEndDate.value = true;
  view.form.value.effective_to = '2026-12-31';
  await view.saveTariff();
  const payload = JSON.parse(calls.filter(call => call.options).pop().options.body);
  assert.equal(payload.distributor, 'Custom distributor');
  assert.equal(payload.tariff_category, 'Custom category');
  assert.equal(payload.currency, 'EUR');
  assert.equal(payload.export_energy_rate, 0.1);
  assert.equal(payload.effective_to, '2026-12-31');
});

test('none hides export price; monetary requires it and energy_credit preserves the optional supported price', () => {
  const { view, nodes } = setup();
  for (const type of ['none', 'energy_credit', 'monetary']) {
    view.form.value.export_compensation_type = type;
    const inputs = nodes().filter(node => node.type === 'input' && node.props?.type === 'number');
    assert.equal(inputs.length, type === 'none' ? 1 : 2);
    if (type !== 'none') assert.equal(inputs[1].props.required, type === 'monetary');
    view.form.value.export_energy_rate = '12';
    assert.equal(view.tariffPayload().export_energy_rate, type === 'none' ? null : 12);
    view.form.value.export_energy_rate = '';
    assert.equal(view.tariffPayload().export_energy_rate, null);
  }
});

test('custom fields, currency selector and optional end date follow selections', () => {
  const { view, nodes } = setup();
  view.distributorChoice.value = 'CRE R.L.';
  assert.equal(nodes().filter(node => node.type === 'input' && node.props?.type === 'date').length, 1);
  assert.equal(nodes().filter(node => node.type === 'select' && node.props?.disabled === true).length, 1);
  view.distributorChoice.value = 'other';
  view.categoryChoice.value = 'other';
  view.hasEndDate.value = true;
  assert.equal(nodes().filter(node => node.type === 'input' && node.props?.maxlength === '120').length, 2);
  assert.equal(nodes().filter(node => node.type === 'input' && node.props?.type === 'date').length, 2);
  assert.equal(nodes().filter(node => node.type === 'select' && node.props?.disabled === true).length, 0);
});

test('closing a historical tariff patches only its end date, preserving legacy data', async () => {
  const { view, calls } = setup();
  view.editTariff({ id: 'old', distributor: 'CRE R.L.', currency: 'GBP', tariff_category: 'Historical',
    purchase_energy_rate: 1, export_energy_rate: 0.4, export_compensation_type: 'energy_credit',
    effective_from: '2020-01-01', effective_to: null });
  assert.equal(view.distributorChoice.value, 'other');
  assert.equal(view.currency.value, 'GBP');
  view.hasEndDate.value = true;
  view.form.value.effective_to = '2026-09-24';
  await view.saveTariff();
  assert.equal(calls.filter(call => call.options)[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls.filter(call => call.options)[0].options.body), { effective_to: '2026-09-24' });
});

test('unchecking end date sends null on edit; new tariff resets custom controls', async () => {
  const { view, calls } = setup();
  view.editTariff({ id: 'future', distributor: null, tariff_category: null, currency: 'BOB',
    purchase_energy_rate: 1, export_compensation_type: 'none', export_energy_rate: null,
    effective_from: '2030-01-01', effective_to: '2031-01-01' });
  view.hasEndDate.value = false;
  await view.saveTariff();
  assert.deepEqual(JSON.parse(calls.filter(call => call.options)[0].options.body), { effective_to: null });
  view.newTariff();
  assert.equal(view.hasEndDate.value, false);
  assert.equal(view.categoryChoice.value, 'none');
  assert.equal(view.form.value.purchase_energy_rate, '');
});

test('blank custom names are rejected without a request', async () => {
  const { view, calls } = setup();
  view.distributorChoice.value = 'other';
  view.form.value.distributor = '   ';
  await view.saveTariff();
  assert.equal(calls.filter(call => call.options).length, 0);
  assert.ok(view.tariffError.value);
});
