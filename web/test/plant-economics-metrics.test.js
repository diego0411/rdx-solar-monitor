import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, reactive, ref, watch } from 'vue';

const flush = () => new Promise(resolve => setImmediate(resolve));

function compileSetup(path, id) {
  const { descriptor } = parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const code = compileScript(descriptor, { id }).content.replace(/^import .*;$/gm, '')
    .replace('export default', 'return');
  return code;
}

const economicsCode = compileSetup('../src/components/PlantEconomics.vue', 'economics-metrics-test');

function createApiFetch() {
  const calls = [];
  const apiFetch = (url, options = {}) => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    calls.push({ url, signal: options.signal ?? null, resolve, reject });
    return promise;
  };
  return { calls, apiFetch };
}

function setupEconomics({ period = 'day', selectedDate = '2026-09-14' } = {}) {
  const { calls, apiFetch } = createApiFetch();
  const emitted = [];
  const props = reactive({ plantId: 'p1', period, selectedDate });
  let unmount = null;
  const deps = {
    ref,
    computed,
    watch,
    onMounted() {},
    onBeforeUnmount(cb) { unmount = cb; },
    getMyProfile: async () => ({ profile: { role: 'client_admin' } }),
    apiFetch,
    compensationValue: () => null,
    creditEstimatedValue: () => null,
  };
  const component = new Function(...Object.keys(deps), economicsCode)(...Object.values(deps));
  const view = component.setup(props, { expose() {}, emit: (...args) => emitted.push(args) });
  return { view, calls, emitted, props, unmount: () => unmount?.() };
}

const metric = (value, valid, total, quality) => ({
  value, valid_intervals: valid, total_intervals: total,
  complete: valid === total && total > 0, quality,
});

function huangSummary() {
  return {
    generation_kwh: 31.7,
    consumption_kwh: null,
    self_consumption_kwh: 4.1,
    grid_import_kwh: 1.6,
    grid_export_kwh: 27.6,
    self_consumption_savings: 3.28,
    currency: 'BOB',
    coverage: { status: 'partial' },
    metrics: {
      generation_kwh: metric(31.7, 158, 158, 'EXACT'),
      consumption_kwh: metric(8, 142, 158, 'PARTIAL'),
      self_consumption_kwh: metric(4.1, 158, 158, 'EXACT'),
      grid_import_kwh: metric(1.6, 158, 158, 'EXACT'),
      grid_export_kwh: metric(27.6, 158, 158, 'EXACT'),
    },
  };
}

test('1. EXACT conserva el escalar legacy sin indicador parcial', () => {
  const { view } = setupEconomics();
  view.summary.value = huangSummary();
  assert.equal(view.metricDisplay.value.generation_kwh.text, view.energy(31.7));
  assert.equal(view.metricDisplay.value.generation_kwh.coverage, '');
  assert.equal(view.metricDisplay.value.self_consumption_kwh.text, view.energy(4.1));
  assert.equal(view.metricDisplay.value.self_consumption_kwh.coverage, '');
});

test('2. PARTIAL muestra valor observado con X/Y y porcentaje', () => {
  const { view } = setupEconomics();
  view.summary.value = huangSummary();
  assert.equal(view.metricDisplay.value.consumption_kwh.text, view.energy(8));
  assert.equal(
    view.metricDisplay.value.consumption_kwh.coverage,
    'Cobertura: 142/158 intervalos (89,9%)',
  );
});

test('3. UNAVAILABLE muestra — sin cobertura', () => {
  const { view } = setupEconomics();
  const summary = huangSummary();
  summary.metrics.consumption_kwh = metric(null, 0, 158, 'UNAVAILABLE');
  view.summary.value = summary;
  assert.equal(view.metricDisplay.value.consumption_kwh.text, '—');
  assert.equal(view.metricDisplay.value.consumption_kwh.coverage, '');
});

test('4. consumo parcial no cambia el ahorro exacto del backend', () => {
  const { view } = setupEconomics();
  view.summary.value = huangSummary();
  assert.equal(view.money(view.summary.value.self_consumption_savings), 'Bs 3,28');
  assert.equal(view.metricDisplay.value.consumption_kwh.coverage.includes('142/158'), true);
});

test('5. respuesta API antigua sin metrics sigue funcionando', async () => {
  const { view, calls } = setupEconomics();
  await flush();
  const economics = calls.filter(call => call.url.includes('/economics?')).at(-1);
  economics.resolve({
    generation_kwh: 10, consumption_kwh: null, self_consumption_kwh: 7,
    grid_import_kwh: 5, grid_export_kwh: 3, coverage: { status: 'partial' },
  });
  await flush();
  await flush();
  assert.equal(view.metricDisplay.value.generation_kwh.text, view.energy(10));
  assert.equal(view.metricDisplay.value.consumption_kwh.text, '—');
  assert.equal(view.metricDisplay.value.consumption_kwh.coverage, '');
  assert.equal(view.error.value, '');
});

test('6. periodos Día/Semana/Mes/Año intactos con metrics', async () => {
  const { view, calls, props } = setupEconomics();
  await flush();
  for (const period of ['day', 'week', 'month', 'year']) {
    props.period = period;
    await flush();
    await flush();
  }
  const last = calls.filter(call => call.url.includes('/economics?')).at(-1);
  assert.ok(last.url.includes('period=year'), last.url);
  assert.deepEqual(view.periods.map(item => item.key), ['day', 'week', 'month', 'year']);
});
