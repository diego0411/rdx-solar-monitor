import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, reactive, ref, watch } from 'vue';

function compileSetup(path, id) {
  const { descriptor } = parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const code = compileScript(descriptor, { id }).content.replace(/^import .*;$/gm, '')
    .replace('export default', 'return');
  return code;
}

const economicsCode = compileSetup('../src/components/PlantEconomics.vue', 'economics-observation-test');

function setupEconomics({ period = 'month', selectedDate = '2026-09-14' } = {}) {
  const { apiFetch } = { apiFetch: async () => ({}) };
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
  return { view, unmount: () => unmount?.() };
}

const metric = (value, valid, total, quality) => ({
  value, valid_intervals: valid, total_intervals: total,
  complete: valid === total && total > 0, quality,
});

const observation = (overrides = {}) => ({
  interval_type: 1,
  rows: { total: 158 },
  first_interval_at: '2026-09-01T16:00:00.000Z',
  last_interval_at: '2026-09-30T16:00:00.000Z',
  last_stored_at: '2026-10-01T02:00:00.000Z',
  providers: ['hyxi'],
  period: { start: '2026-09-01', end: '2026-10-01' },
  period_in_progress: false,
  has_stored_data: true,
  ...overrides,
});

test('A) data_observation ausente mantiene comportamiento legacy', () => {
  const { view } = setupEconomics();
  view.summary.value = { generation_kwh: 10, coverage: { status: 'none' }, metrics: {} };
  assert.equal(view.coverageLabel.value, 'Sin datos energéticos para el periodo');
  assert.equal(view.hasNoStoredData.value, false);
  assert.equal(view.lastStoredText.value, '');
  assert.equal(view.multiProviderStored.value, false);
});

test('B) has_stored_data=false muestra aviso RDX sin afirmar causa', () => {
  const { view } = setupEconomics();
  view.summary.value = {
    generation_kwh: null, coverage: { status: 'none' }, metrics: {},
    data_observation: observation({ rows: { total: 0 }, has_stored_data: false,
      first_interval_at: null, last_interval_at: null, last_stored_at: null, providers: [] }),
  };
  assert.equal(view.coverageLabel.value, 'RDX no tiene datos energéticos almacenados para este período.');
  assert.equal(view.hasNoStoredData.value, true);
  assert.equal(view.showNotConfirmedNote.value, true);
  assert.equal(view.coverageLabel.value.includes('fabricante'), false);
  assert.equal(view.lastStoredText.value, '');
});

test('C) has_stored_data=true no muestra aviso de rango vacío', () => {
  const { view } = setupEconomics();
  view.summary.value = {
    generation_kwh: 31.7, coverage: { status: 'partial' }, metrics: {},
    data_observation: observation(),
  };
  assert.equal(view.hasNoStoredData.value, false);
  assert.equal(view.showNotConfirmedNote.value, false);
  assert.equal(view.coverageLabel.value, 'Cobertura parcial');
});

test('D) last_stored_at válido aparece como metadata auxiliar RDX', () => {
  const { view } = setupEconomics();
  view.summary.value = {
    generation_kwh: 31.7, coverage: { status: 'partial' }, metrics: {},
    data_observation: observation(),
  };
  assert.match(view.lastStoredText.value, /^Último dato almacenado: /);
  assert.equal(view.lastStoredText.value.includes('sincronización'), false);
  view.summary.value = {
    generation_kwh: 31.7, coverage: { status: 'partial' }, metrics: {},
    data_observation: observation({ last_stored_at: null }),
  };
  assert.equal(view.lastStoredText.value, '');
});

test('E) PARTIAL y SUSPECT existentes siguen funcionando con data_observation', () => {
  const { view } = setupEconomics();
  view.summary.value = {
    generation_kwh: 31.7, consumption_kwh: 8, coverage: { status: 'partial' },
    metrics: {
      generation_kwh: metric(31.7, 158, 158, 'EXACT'),
      consumption_kwh: metric(8, 142, 158, 'PARTIAL'),
    },
    data_observation: observation(),
  };
  assert.equal(view.metricDisplay.value.consumption_kwh.text, view.energy(8));
  assert.equal(view.metricDisplay.value.consumption_kwh.coverage.includes('142/158'), true);
  const suspect = {
    generation_kwh: 31.7, consumption_kwh: 8, coverage: { status: 'partial', meter_suspect: true },
    metrics: {
      generation_kwh: metric(31.7, 158, 158, 'SUSPECT'),
      consumption_kwh: metric(8, 142, 158, 'SUSPECT'),
    },
    data_observation: observation(),
  };
  view.summary.value = suspect;
  assert.equal(view.metricDisplay.value.generation_kwh.suspect, true);
  assert.equal(view.coverageLabel.value, 'Medición de red/carga no confirmada. Verifique el medidor/CT y su configuración.');
});

test('F) providers mixtos activan aviso discreto; uno solo no', () => {
  const { view } = setupEconomics();
  view.summary.value = {
    generation_kwh: 31.7, coverage: { status: 'partial' }, metrics: {},
    data_observation: observation({ providers: ['hyxi', 'growatt'] }),
  };
  assert.equal(view.multiProviderStored.value, true);
  view.summary.value = {
    generation_kwh: 31.7, coverage: { status: 'partial' }, metrics: {},
    data_observation: observation(),
  };
  assert.equal(view.multiProviderStored.value, false);
});
