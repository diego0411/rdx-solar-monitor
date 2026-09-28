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

const suspectMetric = (value, valid, total, quality) => ({
  value, valid_intervals: valid, total_intervals: total,
  complete: valid === total && total > 0, quality,
});

function arturoSummary() {
  return {
    generation_kwh: 35.7,
    consumption_kwh: 0,
    self_consumption_kwh: 35.7,
    grid_import_kwh: 0,
    grid_export_kwh: 0,
    self_consumption_savings: 38.1276,
    estimated_economic_benefit: null,
    purchase_energy_rate: 1.068,
    currency: 'BOB',
    compensation_type: 'energy_credit',
    export_credit_kwh: 0,
    coverage: {
      status: 'available', meter_suspect: true, suspect_days: ['2026-09-26'],
      inconsistent_intervals: 0, missing_tariff_intervals: 0, period_in_progress: false,
    },
    metrics: {
      generation_kwh: suspectMetric(35.7, 152, 152, 'EXACT'),
      consumption_kwh: suspectMetric(0, 152, 152, 'SUSPECT'),
      self_consumption_kwh: suspectMetric(null, 152, 152, 'SUSPECT'),
      grid_import_kwh: suspectMetric(0, 152, 152, 'SUSPECT'),
      grid_export_kwh: suspectMetric(0, 152, 152, 'SUSPECT'),
      self_consumption_savings: suspectMetric(null, 152, 152, 'SUSPECT'),
      export_value: suspectMetric(null, 152, 152, 'SUSPECT'),
      estimated_economic_benefit: suspectMetric(null, 0, 0, 'SUSPECT'),
    },
  };
}

test('7. Arturo: warning prioritario + ceros con marca + dinero suprimido', () => {
  const { view } = setupEconomics();
  view.summary.value = arturoSummary();
  assert.equal(view.coverageLabel.value,
    'Medición de red/carga no confirmada. Verifique el medidor/CT y su configuración.');
  assert.equal(view.coverageClass.value, 'coverage-suspect');
  assert.equal(view.metricDisplay.value.generation_kwh.text, view.energy(35.7));
  assert.equal(view.metricDisplay.value.generation_kwh.suspect, false);
  for (const field of ['consumption_kwh', 'grid_import_kwh', 'grid_export_kwh']) {
    assert.equal(view.metricDisplay.value[field].text, view.energy(0));
    assert.equal(view.metricDisplay.value[field].suspect, true);
  }
  assert.equal(view.metricDisplay.value.self_consumption_kwh.text, '—');
  assert.equal(view.savingsDisplay.value, '—');
  assert.equal(view.benefitDisplay.value, '—');
  assert.equal(view.compensationDisplay.value, '—');
  assert.equal(view.creditDisplay.value, '—');
  assert.equal(view.creditValueDisplay.value, 'No disponible');
  assert.equal(view.rate(view.summary.value.purchase_energy_rate, 'BOB'), 'Bs 1,068/kWh');
});

test('8. prioridad: suspect vence a inconsistencia, tarifa, parcial y curso', () => {
  const { view } = setupEconomics();
  const summary = arturoSummary();
  summary.coverage.inconsistent_intervals = 5;
  summary.coverage.missing_tariff_intervals = 2;
  summary.coverage.status = 'partial';
  summary.coverage.period_in_progress = true;
  view.summary.value = summary;
  assert.ok(view.coverageLabel.value.includes('no confirmada'));
  const plain = { ...summary, coverage: { ...summary.coverage, meter_suspect: false } };
  view.summary.value = plain;
  assert.equal(view.coverageLabel.value, 'Datos inconsistentes: autoconsumo no calculable');
});

test('9. período en curso muestra mensaje informativo sin standby', () => {
  const { view } = setupEconomics();
  view.summary.value = {
    generation_kwh: 5, consumption_kwh: 6, self_consumption_kwh: 4,
    grid_import_kwh: 2, grid_export_kwh: 1,
    coverage: { status: 'available', period_in_progress: true },
    metrics: {
      generation_kwh: metric(5, 10, 10, 'EXACT'),
      consumption_kwh: metric(6, 10, 10, 'EXACT'),
      self_consumption_kwh: metric(4, 10, 10, 'EXACT'),
      grid_import_kwh: metric(2, 10, 10, 'EXACT'),
      grid_export_kwh: metric(1, 10, 10, 'EXACT'),
    },
  };
  assert.equal(view.coverageLabel.value,
    'Período en curso. Los valores corresponden a los datos registrados hasta el momento.');
  assert.ok(!view.coverageLabel.value.toLowerCase().includes('standby'));
});

test('10. fecha histórica sana no muestra banner', () => {
  const { view } = setupEconomics();
  view.summary.value = {
    generation_kwh: 10, consumption_kwh: 12, self_consumption_kwh: 7,
    grid_import_kwh: 5, grid_export_kwh: 3, self_consumption_savings: 5.6,
    estimated_economic_benefit: 7.1,
    coverage: { status: 'available', period_in_progress: false },
    metrics: {
      generation_kwh: metric(10, 3, 3, 'EXACT'),
      consumption_kwh: metric(12, 3, 3, 'EXACT'),
      self_consumption_kwh: metric(7, 3, 3, 'EXACT'),
      grid_import_kwh: metric(5, 3, 3, 'EXACT'),
      grid_export_kwh: metric(3, 3, 3, 'EXACT'),
      self_consumption_savings: metric(5.6, 3, 3, 'EXACT'),
      estimated_economic_benefit: metric(7.1, 3, 3, 'EXACT'),
    },
  };
  assert.equal(view.coverageLabel.value, '');
  assert.equal(view.savingsDisplay.value, view.money(5.6));
  assert.equal(view.benefitDisplay.value, view.money(7.1));
});
