import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ECO-04D2: vista previa energética con datos reales del contrato
// energy-history (vía componente compartido). Sin agregaciones propias.

const view = readFileSync(new URL('../src/views/ReportsView.vue', import.meta.url), 'utf8');

test('1: gráfico reutilizado con datos reales del contrato', () => {
  assert.match(view, /import PlantEnergyHistory from '\.\.\/components\/PlantEnergyHistory\.vue'/);
  assert.match(view, /<PlantEnergyHistory/);
  assert.match(view, /@history-loaded="onHistoryLoaded"/);
  assert.match(view, /:plant-id="preview\.plantId"/);
});

test('2: consulta real solo al generar (overview para timezone)', () => {
  assert.match(view, /\/plants\/\$\{encodeURIComponent\(plantId\.value\)\}\/overview/);
  assert.ok(!view.includes('/economics'), 'sin endpoint económico');
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

test('5: estados de carga, vacío, error y tipo económico intacto', () => {
  assert.match(view, /previewLoading/);
  assert.match(view, /previewError/);
  assert.match(view, /history\?\.start && history\?\.end/);
  assert.match(view, /preview\.type === 'energy_economics'/);
  assert.match(view, /aún no está habilitada/);
  assert.ok(!view.includes('jsPDF') && !view.includes('pdfmake'), 'sin PDF');
  assert.match(view, /\.period-controls\) \{ display: none; \}/);
});
