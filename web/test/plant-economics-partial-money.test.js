import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, reactive, ref, watch } from 'vue';

const { descriptor } = parse(readFileSync(new URL('../src/components/PlantEconomics.vue', import.meta.url), 'utf8'));
const economicsCode = compileScript(descriptor, { id: 'economics-partial-money-test' }).content
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

function arturoLike() {
  return {
    generation_kwh: 27.4,
    consumption_kwh: null,
    self_consumption_kwh: null,
    grid_import_kwh: null,
    grid_export_kwh: null,
    self_consumption_savings: null,
    estimated_economic_benefit: null,
    purchase_energy_rate: 1.068,
    currency: 'BOB',
    compensation_type: 'energy_credit',
    export_credit_kwh: null,
    coverage: { status: 'partial', meter_suspect: false, inconsistent_intervals: 0 },
    metrics: {
      generation_kwh: metric(27.4, 95, 95, 'EXACT'),
      consumption_kwh: metric(7.6, 75, 95, 'PARTIAL'),
      self_consumption_kwh: metric(2.7, 82, 95, 'PARTIAL'),
      grid_import_kwh: metric(5.2, 93, 95, 'PARTIAL'),
      grid_export_kwh: metric(24.9, 82, 95, 'PARTIAL'),
      self_consumption_savings: metric(2.88, 82, 95, 'PARTIAL'),
      export_value: metric(null, 0, 95, 'UNAVAILABLE'),
      estimated_economic_benefit: metric(null, 0, 95, 'UNAVAILABLE'),
    },
  };
}

test('1. savings PARTIAL válido se muestra con cobertura aunque el legacy sea null', () => {
  const view = setupEconomics(arturoLike());
  assert.equal(view.savingsDisplay.value, 'Bs 2,88');
  assert.equal(view.savingsCoverage.value, 'Cobertura: 82/95 intervalos (86,3%)');
});

test('2. métrica null mantiene — sin cobertura', () => {
  const view = setupEconomics(arturoLike());
  assert.equal(view.benefitDisplay.value, '—');
  assert.equal(view.benefitCoverage.value, '');
  assert.equal(view.compensationDisplay.value, '—');
});

test('3. SUSPECT conserva supresión de dinero aunque exista métrica', () => {
  const view = setupEconomics(arturoLike());
  const summary = view.summary.value;
  summary.metrics.self_consumption_savings = metric(null, 95, 95, 'SUSPECT');
  summary.coverage.meter_suspect = true;
  view.summary.value = summary;
  assert.equal(view.savingsDisplay.value, '—');
  assert.equal(view.savingsCoverage.value, '');
});
