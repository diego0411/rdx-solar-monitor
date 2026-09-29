import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, reactive, ref, watch } from 'vue';

const { descriptor } = parse(readFileSync(new URL('../src/components/PlantEconomics.vue', import.meta.url), 'utf8'));
const economicsCode = compileScript(descriptor, { id: 'economics-energy-credit-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');

function setupEconomics(summary) {
  const deps = {
    ref, computed, watch,
    onMounted() {},
    onBeforeUnmount() {},
    getMyProfile: async () => ({ profile: { role: 'client_user' } }),
    apiFetch: () => new Promise(() => {}),
    compensationValue: () => null,
    creditEstimatedValue: () => null,
  };
  const component = new Function(...Object.keys(deps), economicsCode)(...Object.values(deps));
  const props = reactive({ plantId: 'p1', period: 'day', selectedDate: '2026-09-29' });
  const view = component.setup(props, { expose() {}, emit() {} });
  view.summary.value = summary;
  return view;
}

const metric = (value, valid, total, quality) => ({
  value, valid_intervals: valid, total_intervals: total,
  complete: valid === total && total > 0, quality,
});

function creditSummary(creditMetric) {
  return {
    generation_kwh: 28.5,
    consumption_kwh: null,
    self_consumption_kwh: null,
    grid_import_kwh: null,
    grid_export_kwh: null,
    self_consumption_savings: 2.99,
    estimated_economic_benefit: null,
    purchase_energy_rate: 1.068,
    currency: 'BOB',
    compensation_type: 'energy_credit',
    export_credit_kwh: null,
    export_credit_estimated_value: null,
    coverage: { status: 'partial', meter_suspect: false, inconsistent_intervals: 0 },
    metrics: {
      generation_kwh: metric(28.5, 99, 99, 'EXACT'),
      consumption_kwh: metric(null, 0, 99, 'UNAVAILABLE'),
      self_consumption_kwh: metric(2.8, 86, 99, 'PARTIAL'),
      grid_import_kwh: metric(null, 0, 99, 'UNAVAILABLE'),
      grid_export_kwh: metric(26.3, 86, 99, 'PARTIAL'),
      self_consumption_savings: metric(2.99, 86, 99, 'PARTIAL'),
      export_value: metric(null, 0, 99, 'UNAVAILABLE'),
      estimated_economic_benefit: metric(null, 0, 99, 'UNAVAILABLE'),
      energy_credit_generated_kwh: creditMetric,
    },
  };
}

test('1. energy_credit PARTIAL muestra kWh con cobertura', () => {
  const view = setupEconomics(creditSummary(metric(26.3, 86, 99, 'PARTIAL')));
  assert.equal(view.creditDisplay.value, '26,3 kWh');
  assert.equal(view.creditCoverage.value, 'Cobertura: 86/99 intervalos (86,9%)');
});

test('2. energy_credit EXACT muestra kWh sin cobertura parcial', () => {
  const view = setupEconomics(creditSummary(metric(26.3, 99, 99, 'EXACT')));
  assert.equal(view.creditDisplay.value, '26,3 kWh');
  assert.equal(view.creditCoverage.value, '');
});

test('3. crédito no disponible mantiene —', () => {
  const view = setupEconomics(creditSummary(metric(null, 0, 99, 'UNAVAILABLE')));
  assert.equal(view.creditDisplay.value, '—');
  assert.equal(view.creditCoverage.value, '');
});

test('4. valor económico estimado sigue No disponible', () => {
  const view = setupEconomics(creditSummary(metric(26.3, 86, 99, 'PARTIAL')));
  assert.equal(view.creditValueDisplay.value, 'No disponible');
});

test('5. beneficio total sigue — sin valoración monetaria', () => {
  const view = setupEconomics(creditSummary(metric(26.3, 86, 99, 'PARTIAL')));
  assert.equal(view.benefitDisplay.value, '—');
  assert.equal(view.savingsDisplay.value, 'Bs 2,99');
});

test('6. SUSPECT no muestra crédito generado artificial', () => {
  const view = setupEconomics(creditSummary(metric(0, 99, 99, 'SUSPECT')));
  assert.equal(view.creditDisplay.value, '—');
  assert.equal(view.creditCoverage.value, '');
});
