import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import * as vue from 'vue';
import * as renderer from 'vue/server-renderer';
import { buildReportIndicators, buildReportCopy } from '../src/utils/reportPresentation.js';

const { descriptor } = parse(readFileSync(new URL('../src/views/ReportsView.vue', import.meta.url), 'utf8'));
const script = compileScript(descriptor, { id: 'reports-economic-loading-test' });
const setupCode = script.content.replace(/^import .*;$/gm, '').replace('export default', 'return');
const template = compileTemplate({ source: descriptor.template.content, filename: 'ReportsView.vue',
  id: 'reports-economic-loading-test', ssr: true, ssrCssVars: descriptor.cssVars,
  compilerOptions: { bindingMetadata: script.bindings } });
assert.deepEqual(template.errors, []);
const renderDeps = {};
const renderCode = template.code.replace(/^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?$/gm, (_, bindings, module) => {
  const exports = module === 'vue' ? vue : renderer;
  for (const binding of bindings.split(',')) {
    const [name, alias = name] = binding.trim().split(/\s+as\s+/);
    renderDeps[alias] = exports[name];
  }
  return '';
}).replace('export function ssrRender', 'return function ssrRender');
const ssrRender = new Function(...Object.keys(renderDeps), renderCode)(...Object.values(renderDeps));
const flush = () => new Promise(resolve => setImmediate(resolve));

function summary(overrides = {}) {
  const metric = value => ({ value, quality: 'EXACT', valid_intervals: 10, total_intervals: 10 });
  return {
    period: 'day', start: '2026-09-27', end: '2026-09-28', currency: 'BOB',
    generation_kwh: 10, consumption_kwh: 4, self_consumption_kwh: 3,
    grid_import_kwh: 1, grid_export_kwh: 7,
    production_value: 10.68, self_consumption_savings: 3.204, export_value: 7.476,
    export_compensation_value: 7.476, estimated_economic_benefit: 10.68,
    export_credit_kwh: 7, export_credit_estimated_value: 7.476,
    purchase_energy_rate: 1.068, export_energy_rate: null, compensation_type: 'energy_credit',
    coverage: { status: 'available', intervals: 10, missing_tariff_intervals: 0, period_in_progress: false },
    metrics: { generation_kwh: metric(10), consumption_kwh: metric(4), self_consumption_kwh: metric(3),
      grid_import_kwh: metric(1), grid_export_kwh: metric(7), self_consumption_savings: metric(3.204),
      export_value: metric(7.476), estimated_economic_benefit: metric(10.68), energy_credit_generated_kwh: metric(7) },
    ...overrides,
  };
}

function setup() {
  const calls = [];
  const deps = {
    ref: vue.ref, computed: vue.computed, onMounted() {}, onUnmounted() {},
    apiFetch(url, { signal }) {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      calls.push({ url, signal, resolve, reject });
      return promise;
    },
    getPlantsCatalog() { throw new Error('Unexpected catalog fetch'); },
    PlantEnergyHistory: { render: () => null },
    buildReportIndicators, buildReportCopy, clearRdxColorCache() {}, getInstanceByDom: () => null,
  };
  const component = new Function(...Object.keys(deps), setupCode)(...Object.values(deps));
  const state = component.setup({}, { expose() {} });
  state.loading.value = false;
  state.plants.value = [{ id: 'p1', name: 'Arturo' }, { id: 'p2', name: 'HYXi' }];
  state.plantId.value = 'p1';
  state.period.value = 'day';
  state.selectedDate.value = '2026-09-27';
  state.reportType.value = 'energy_economics';
  return { state, calls, html: () => renderer.renderToString(vue.createSSRApp({ setup: () => state, ssrRender })) };
}

async function reachEconomics(s) {
  const pending = s.state.requestReport();
  assert.equal(s.calls.length, 1);
  s.calls[0].resolve({ plant: { name: 'Arturo', timezone: 'GMT-4' } });
  await flush();
  assert.equal(s.calls.length, 2);
  assert.match(s.calls[1].url, /\/economics\?/);
  return { pending, economicCall: s.calls[1] };
}

test('ECO-04G3: estado inicial sin reporte ni consultas económicas', async () => {
  const s = setup();
  assert.equal(s.state.report.value, null);
  assert.equal(s.state.canPrint.value, false);
  const html = await s.html();
  assert.ok(!html.includes('Indicadores monetarios'));
  assert.equal(s.calls.length, 0);
});

test('ECO-04G3: espera de overview no renderiza tarifas nulas', async () => {
  const s = setup();
  const pending = s.state.requestReport();
  const html = await s.html();
  assert.match(html, /Cargando información de la planta/);
  assert.ok(!html.includes('Indicadores monetarios'));
  assert.equal(s.state.report.value, null);
  assert.equal(s.state.canPrint.value, false);
  assert.equal(s.calls.length, 1);
  s.calls[0].resolve({ plant: { name: 'Arturo', timezone: 'GMT-4' } });
  await flush();
  s.calls[1].resolve(summary());
  await pending;
});

test('ECO-04G3: respuesta económica tardía pasa de carga a reporte sin consultas duplicadas', async () => {
  const s = setup();
  const { pending, economicCall } = await reachEconomics(s);
  const loading = await s.html();
  assert.match(loading, /Cargando indicadores económicos/);
  assert.ok(!loading.includes('Indicadores monetarios'));
  assert.equal(s.state.report.value, null);
  assert.equal(s.state.canPrint.value, false);
  economicCall.resolve(summary());
  await pending;
  const ready = await s.html();
  assert.match(ready, /Indicadores monetarios/);
  assert.match(ready, /Bs 10,68/);
  assert.equal(s.state.report.value.tariffs.currency, 'BOB');
  assert.equal(s.state.report.value.money.production_value.raw, 10.68);
  assert.equal(s.state.report.value.monetaryPublishable.publishable, true);
  assert.equal(s.state.ecoLoading.value, false);
  s.state.onHistoryLoaded({ bucket: 'intraday', buckets: [] });
  assert.equal(s.state.canPrint.value, true);
  assert.equal(s.calls.filter(c => c.url.includes('/overview')).length, 1);
  assert.equal(s.calls.filter(c => c.url.includes('/economics?')).length, 1);
});

test('ECO-04G3: error HTTP muestra el error real sin construir un reporte ficticio', async () => {
  const s = setup();
  const { pending, economicCall } = await reachEconomics(s);
  economicCall.reject(Object.assign(new Error('HTTP 503'), { status: 503 }));
  await pending;
  const html = await s.html();
  assert.match(html, /No se pudieron cargar los indicadores económicos/);
  assert.ok(!html.includes('Indicadores monetarios'));
  assert.equal(s.state.report.value, null);
  assert.equal(s.state.economicsData.value, null);
  assert.equal(s.state.ecoLoading.value, false);
  assert.equal(s.state.canPrint.value, false);
  assert.equal(s.calls.length, 2);
});

test('ECO-04G3: datos económicos null mantienen el error de respuesta inválida y no inventan moneda', async () => {
  const s = setup();
  const { pending, economicCall } = await reachEconomics(s);
  economicCall.resolve(null);
  await pending;
  const html = await s.html();
  assert.match(html, /No se pudieron cargar los indicadores económicos/);
  assert.ok(!html.includes('Tarifas y moneda'));
  assert.equal(s.state.report.value, null);
  assert.equal(s.state.economicsData.value, null);
  assert.equal(s.state.canPrint.value, false);
});

test('ECO-04G3: cambios de planta, periodo o tipo descartan la respuesta anterior sin duplicar consultas', async () => {
  for (const [field, value] of [['plantId', 'p2'], ['period', 'month'], ['reportType', 'energy']]) {
    const s = setup();
    const { pending, economicCall } = await reachEconomics(s);
    s.state[field].value = value;
    s.state.invalidatePreview();
    assert.equal(economicCall.signal.aborted, true);
    assert.equal(s.state.report.value, null);
    const next = s.state.requestReport();
    const html = await s.html();
    assert.ok(!html.includes('Indicadores monetarios'));
    economicCall.resolve(summary({ currency: 'USD' }));
    await pending;
    assert.equal(s.state.economicsData.value, null, 'respuesta vieja descartada');
    assert.equal(s.calls.length, 3);
    s.calls[2].resolve({ plant: { name: 'Planta actual', timezone: 'GMT-4' } });
    await flush();
    if (value === 'energy') {
      assert.equal(s.calls.length, 3, 'tipo energético no consulta economía');
    } else {
      assert.equal(s.calls.length, 4);
      s.calls[3].resolve(summary());
    }
    await next;
    assert.equal(s.state.preview.value.plantName, 'Planta actual');
    if (value === 'energy') assert.equal(s.state.report.value, null);
    else assert.equal(s.state.report.value.tariffs.currency, 'BOB');
    await s.html();
  }
});

test('ECO-04G3: respuesta válida con moneda y tarifas null conserva los null originales', async () => {
  const s = setup();
  const { pending, economicCall } = await reachEconomics(s);
  const unavailable = { value: null, quality: 'UNAVAILABLE', valid_intervals: 0, total_intervals: 10 };
  const data = summary({ currency: null, purchase_energy_rate: null, production_value: null,
    self_consumption_savings: null, export_value: null, export_compensation_value: null,
    estimated_economic_benefit: null, export_credit_estimated_value: null });
  data.metrics.self_consumption_savings = unavailable;
  data.metrics.export_value = unavailable;
  data.metrics.estimated_economic_benefit = unavailable;
  economicCall.resolve(data);
  await pending;
  const html = await s.html();
  assert.match(html, /Moneda: No determinada/);
  assert.ok(!html.includes('Bs 0,00'));
  assert.equal(s.state.report.value.tariffs.currency, null);
  assert.equal(s.state.report.value.tariffs.purchase_energy_rate.raw, null);
  assert.equal(s.state.report.value.money.production_value.raw, null);
  assert.equal(s.state.report.value.money.production_value.text, '—');
  assert.equal(s.state.report.value.monetaryPublishable.publishable, false);
});
