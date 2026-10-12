import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ECO-04D3: indicadores confiables del contrato economics preparados
// exclusivamente con buildReportIndicators(). Sin fórmulas propias.

const view = readFileSync(new URL('../src/views/ReportsView.vue', import.meta.url), 'utf8');

test('1: economics solo al generar el tipo económico', () => {
  assert.match(view, /import \{ buildReportIndicators, buildReportCopy \} from '\.\.\/utils\/reportPresentation\.js'/);
  assert.match(view, /\/plants\/\$\{encodeURIComponent\(plantId\.value\)\}\/economics\?period=/);
  assert.match(view, /reportType\.value !== 'energy_economics'/);
  assert.match(view, /buildReportIndicators\(economicsData\.value\)/);
});

test('2: KPIs energéticos y monetarios solo económico', () => {
  assert.match(view, /energyKpiFields/);
  assert.match(view, /moneyKpiFields/);
  assert.match(view, /<template v-if="isEconomicPreview">/);
  assert.match(view, /report\.energy\[field\]/);
  assert.match(view, /report\.money\[field\]/);
});

test('3: estados, cobertura, publicación y moneda', () => {
  assert.match(view, /statusClasses\[report\.\w+\[field\]\?\.status\]/);
  assert.match(view, /report\.monetaryPublishable\.publishable/);
  assert.match(view, /reportCopy\.publicationWarning/);
  assert.match(view, /report\.tariffs\.currency/);
  assert.match(view, /report\.credit\.value\.rule === 'purchase-price'/);
  assert.match(view, /v-for="notice in report\.disclaimers"/);
});

test('4: zona no determinada, obsolescencia e invalidación', () => {
  assert.match(view, /no puede considerarse verificado/);
  assert.match(view, /ecoController\?\.abort\(\)/);
  assert.match(view, /economicsData\.value = null/);
  assert.match(view, /if \(ecoRequest\.signal\.aborted\) return/);
  assert.ok(!view.includes('jsPDF') && !view.includes('pdfmake'), 'sin PDF');
  assert.ok(!view.includes('.reduce('), 'sin agregaciones propias');
});
