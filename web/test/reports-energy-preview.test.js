import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';
import { buildReportIndicators, buildReportCopy } from '../src/utils/reportPresentation.js';

// ECO-04D2: vista previa energética con datos reales del contrato
// energy-history (vía componente compartido). Sin agregaciones propias.

const view = readFileSync(new URL('../src/views/ReportsView.vue', import.meta.url), 'utf8');

test('1: gráfico reutilizado con datos reales del contrato', () => {
  assert.match(view, /import PlantEnergyHistory from '\.\.\/components\/PlantEnergyHistory\.vue'/);
  assert.match(view, /<PlantEnergyHistory/);
  assert.match(view, /@history-loaded="onHistoryLoaded"/);
  assert.match(view, /:plant-id="preview\.plantId"/);
});

test('2: consultas reales solo al generar (overview; economics solo económico)', () => {
  assert.match(view, /\/plants\/\$\{encodeURIComponent\(plantId\.value\)\}\/overview/);
  assert.match(view, /\/plants\/\$\{encodeURIComponent\(plantId\.value\)\}\/economics\?period=/);
  assert.match(view, /reportType\.value !== 'energy_economics'/);
  assert.ok(!view.includes('energy-history?'), 'el componente hace su propia consulta');
  assert.ok(!view.includes('watch('), 'sin consultas reactivas automáticas');
});

test('3: filtros editados invalidan la foto anterior', () => {
  assert.match(view, /function invalidatePreview\(\)/);
  const changes = view.match(/@change="invalidatePreview"/g) ?? [];
  assert.ok(changes.length >= 4, 'los cuatro selectores invalidan');
  assert.match(view, /v-model:period="chartPeriod"/);
  assert.match(view, /v-model:selected-date="chartDate"/);
  assert.ok(!view.includes('v-model:period="period"') || view.includes('chartPeriod'), 'el gráfico no usa el borrador');
});

test('4: cobertura por conteo sin sumar energía', () => {
  assert.match(view, /coverageCounts/);
  assert.match(view, /bucket\?\.coverage === 'available'/);
  assert.ok(!view.includes('.reduce('), 'sin agregaciones propias');
  assert.ok(!view.includes('?? 0'), 'sin null→0');
});

test('5: estados de carga, vacío, error y gráfico intacto', () => {
  assert.match(view, /previewLoading/);
  assert.match(view, /previewError/);
  assert.match(view, /history\?\.start && history\?\.end/);
  assert.match(view, /ecoLoading/);
  assert.ok(!view.includes('jsPDF') && !view.includes('pdfmake'), 'sin PDF');
  assert.match(view, /\.period-controls\) \{ display: none; \}/);
});

const { descriptor } = parse(view);
const code = compileScript(descriptor, { id: 'reports-coverage-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');
const fields = ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh'];
const point = values => ({ interval_start: '2026-09-27T10:00:00Z', timezone: 'GMT-4',
  ...Object.fromEntries(fields.map((field, i) => [field, values[i]])) });

function coverage(history) {
  const deps = {
    ref, computed, onMounted() {}, onUnmounted() {},
    apiFetch() { throw new Error('Coverage must not fetch'); }, getPlantsCatalog() {},
    PlantEnergyHistory: {}, buildReportIndicators, buildReportCopy,
    clearRdxColorCache() {}, getInstanceByDom: () => null,
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const state = component.setup({}, { expose() {} });
  const snapshot = structuredClone(history);
  state.onHistoryLoaded(history);
  const result = state.coverageCounts.value;
  assert.deepEqual(history, snapshot, 'el histórico recibido queda intacto');
  return result;
}

test('ECO-04G2: Día con cuatro mediciones presentes no necesita coverage', () => {
  assert.deepEqual(coverage({ bucket: 'intraday', buckets: [point([12, 7, 0, 5])] }),
    { total: 1, available: 1, partial: 0, none: 0 });
});

test('ECO-04G2: null explícito distingue puntos parciales de puntos sin mediciones', () => {
  assert.deepEqual(coverage({ bucket: 'intraday', buckets: [
    point([2, 1, 0, 1]), point([3, null, 0, 2]), point([null, null, 0, null]), point([null, null, null, null]),
  ] }), { total: 4, available: 1, partial: 2, none: 1 });
});

test('ECO-04G2: cero válido y valores numéricos serializados no se interpretan como ausencia', () => {
  assert.deepEqual(coverage({ bucket: 'intraday', buckets: [point([0, 0, 0, 0]), point(['0', '2.5', '0.0', '1'])] }),
    { total: 2, available: 2, partial: 0, none: 0 });
});

test('ECO-04G2: campos ausentes o inválidos dejan la cobertura indeterminada', () => {
  for (const invalid of [undefined, '', ' ', 'no-dato', false, NaN, Infinity]) {
    assert.equal(coverage({ bucket: 'intraday', buckets: [point([1, 2, 0, 0]), point([invalid, null, null, null])] }), null);
  }
  const missing = point([1, 2, 0, 0]);
  delete missing.consumption_kwh;
  assert.equal(coverage({ bucket: 'intraday', buckets: [missing] }), null);
  assert.equal(coverage({ buckets: [point([1, 2, 0, 0])] }), null, 'sin contrato intradiario ni coverage no se inventa clasificación');
});

test('ECO-04G2: histórico vacío cuenta cero registros sin fabricar intervalos esperados', () => {
  assert.deepEqual(coverage({ bucket: 'intraday', buckets: [] }), { total: 0, available: 0, partial: 0, none: 0 });
  assert.equal(coverage(null), null);
  assert.equal(coverage({ bucket: 'intraday', buckets: null }), null);
});

test('ECO-04G2: Semana/Mes/Año conservan los estados coverage del contrato agregado', () => {
  for (const [period, bucket] of [['week', 'day'], ['month', 'day'], ['year', 'month']]) {
    assert.deepEqual(coverage({ period, bucket, buckets: [
      { ...point([1, 1, 0, 0]), coverage: 'available' },
      { ...point([1, null, 0, null]), coverage: 'partial' },
      { ...point([null, null, null, null]), coverage: 'none' },
    ] }), { total: 3, available: 1, partial: 1, none: 1 });
  }
});

test('ECO-04G2: provenance visual no cambia la presencia de mediciones recibidas', () => {
  const stored = { ...point([5, 5, 4, 2]), energy_provenance: {
    consumption_kwh: { depends_on_first_daily_counter: true },
    grid_import_kwh: { first_daily_counter: true },
    grid_export_kwh: { first_daily_counter: true },
  } };
  assert.deepEqual(coverage({ bucket: 'intraday', buckets: [stored] }), { total: 1, available: 1, partial: 0, none: 0 });
});
