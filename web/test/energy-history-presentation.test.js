import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed, mergeModels } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { toVisualEnergyPoint } from '../src/utils/energyHistoryChart.js';
import { resolveChartTimeZone } from '../src/utils/chartTimezone.js';

const source = readFileSync(new URL('../src/components/PlantEnergyHistory.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'energy-presentation-test' }).content
  .replace(/^import .*;?$/gm, '').replace('export default', 'return');
const fields = ['generation_kwh', 'consumption_kwh', 'grid_import_kwh', 'grid_export_kwh'];
const names = ['Generación', 'Consumo', 'Importación de red', 'Exportación de red'];
const buckets = Array.from({ length: 24 }, (_, i) => ({
  interval_start: new Date(Date.UTC(2026, 9, 9, i)).toISOString(),
  generation_kwh: i === 3 ? null : i * 123.45,
  consumption_kwh: i * 97,
  grid_import_kwh: i === 6 ? null : 0,
  grid_export_kwh: i * 3,
}));

function setup(period = 'day', overrides = {}) {
  let option;
  const deps = {
    ref, computed, _mergeModels: mergeModels, watch() {}, onMounted() {}, onBeforeUnmount() {},
    _useModel: (props, key) => ref(props[key]),
    echarts: { use() {}, init: () => ({ setOption(value) { option = value; } }) },
    BarChart, LineChart, DataZoomComponent, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer: {},
    ResizeObserver: class { observe() {} }, apiFetch() { throw new Error('Unexpected fetch'); },
    rdxColor: name => name, resolveChartTimeZone, toVisualEnergyPoint,
    ...overrides,
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({ plantId: 'p1', selectedDate: '2026-10-09', period, timezone: 'GMT-4' }, { expose() {}, emit() {} });
  view.points.value = structuredClone(buckets);
  view.container.value = {};
  view.render();
  return { option, view };
}

test('cuatro series conservan cada timestamp, valor, cero y nulo en todos los períodos', () => {
  for (const period of ['day', 'week', 'month', 'year']) {
    const { option, view } = setup(period);
    assert.deepEqual(option.xAxis.data, buckets.map(p => p.interval_start));
    assert.deepEqual(option.series.map(s => s.name), names);
    option.series.forEach((series, i) => {
      assert.deepEqual(series.data, buckets.map(p => p[fields[i]]));
      if (i >= 2) assert.equal(series.smooth, false);
      if (i >= 2) assert.equal(series.connectNulls, false);
      assert.equal(series.sampling, undefined);
      assert.equal(series.stack, undefined);
    });
    assert.deepEqual(view.points.value, buckets);
  }
});

test('carga mantiene períodos, timestamps y tratamiento diario de provenance sin mutar respuesta', async () => {
  for (const period of ['day', 'week', 'month', 'year']) {
    let load;
    let request;
    const response = { buckets: [...structuredClone(buckets)].reverse() };
    response.buckets[0].energy_provenance = {
      grid_import_kwh: { first_daily_counter: true },
      consumption_kwh: { depends_on_first_daily_counter: true },
    };
    const snapshot = structuredClone(response);
    const { view } = setup(period, {
      watch(_source, callback, options) { if (options?.immediate) load = callback; },
      async apiFetch(url) { request = url; return response; },
    });
    await load(['p1', '2026-10-09', period], undefined, () => {});
    const query = new URL(request, 'https://local.invalid').searchParams;
    assert.equal(query.get('period'), period);
    assert.equal(query.get('startTime'), '2026-10-09');
    assert.equal(query.get('timeType'), period === 'month' ? '2' : period === 'year' ? '3' : '1');
    const sorted = [...response.buckets].reverse();
    assert.deepEqual(view.points.value, period === 'day' ? sorted.map(toVisualEnergyPoint) : sorted);
    assert.deepEqual(response, snapshot);
  }
});

test('jerarquía, tokens y zoom inside sin filtrado ni slider', () => {
  const { option } = setup();
  assert.deepEqual(option.color, ['--rdx-chart-green', '--rdx-chart-amber', '--rdx-chart-blue', '--rdx-chart-purple']);
  assert.deepEqual(option.series.map(s => s.type), ['bar', 'bar', 'line', 'line']);
  for (const bar of option.series.slice(0, 2)) {
    assert.equal(bar.barMinWidth, '0%');
    assert.equal(bar.barMaxWidth, 24);
    assert.equal(bar.barGap, '20%');
    assert.equal(bar.barCategoryGap, '35%');
  }
  assert.deepEqual(option.series.slice(2).map(s => s.lineStyle), [{ width: 1.5, type: 'dashed' }, { width: 1.5, type: 'dotted' }]);
  assert.ok(option.series.slice(2).every(s => s.showSymbol && s.symbolSize === 4));
  assert.deepEqual(option.dataZoom, [{
    type: 'inside', xAxisIndex: [0], filterMode: 'none',
    preventDefaultMouseMove: false,
    zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, moveOnMouseMove: false,
  }]);
  assert.equal(option.tooltip.confine, true);
  assert.equal(option.yAxis.name, 'Energía (kWh)');
  assert.equal(option.xAxis.axisLabel.hideOverlap, true);
  assert.equal(option.yAxis.axisLabel.hideOverlap, true);
});

test('tooltip muestra cuatro valores individuales en kWh, incluso series nulas omitidas por ECharts', () => {
  const { option, view } = setup();
  const number = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 });
  for (const index of [0, 3, 6, 12]) {
    const result = option.tooltip.formatter([{ dataIndex: index }]);
    assert.equal(result.split('\n').length, 5);
    fields.forEach((field, i) => {
      const value = buckets[index][field];
      assert.ok(result.includes(names[i] + ': ' + (value == null ? 'Sin datos' : number.format(value) + ' kWh')));
    });
  }
  view.points.value = [{ ...buckets[0], ...Object.fromEntries(fields.map(field => [field, null])) }];
  assert.equal(option.tooltip.formatter([{ dataIndex: 0 }]).split('Sin datos').length, 5);
  assert.equal(option.tooltip.formatter([]), '');
});

test('aria-label refleja el período seleccionado', () => {
  for (const [period, label] of [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']]) {
    assert.equal(setup(period).view.periodLabel.value, label);
  }
  assert.match(source, /:aria-label="`Histórico energético \(\$\{periodLabel\}\)/);
});

echarts.use([BarChart, LineChart, DataZoomComponent, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);
test('barras de grupos vecinos no se solapan hasta 288 muestras en los seis anchos', () => {
  const { option } = setup();
  option.animation = false;
  for (const count of [24, 96, 288]) {
    option.xAxis.data = Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 9, 9, 0, i)).toISOString());
    option.series.forEach(series => { series.data = Array(count).fill(1); });
    for (const width of [328, 390, 720, 900, 1200, 1600]) {
      const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height: width <= 600 ? 300 : 320 });
      try {
        chart.setOption(option);
        const generation = chart.getModel().getSeriesByIndex(0).getData();
        const consumption = chart.getModel().getSeriesByIndex(1).getData();
        for (let i = 0; i < count - 1; i++) {
          const first = generation.getItemLayout(i);
          const second = consumption.getItemLayout(i);
          const next = generation.getItemLayout(i + 1);
          assert.ok(first.width > 0 && second.width > 0);
          assert.ok(first.x + first.width <= second.x + 1e-6);
          assert.ok(second.x + second.width <= next.x + 1e-6, `${count} puntos, ${width}px, grupo ${i}: ${JSON.stringify({ first, second, next })}`);
        }
        for (let i = 0; i < 4; i++) {
          assert.equal(chart.getModel().getSeriesByIndex(i).getData().count(), count);
        }
      } finally { chart.dispose(); }
    }
  }
});

test('rueda normal no llega a ECharts ni cancela scroll; Ctrl+rueda conserva zoom', () => {
  const { view, option } = setup();
  assert.match(source, /@wheel\.capture="preservePageScroll"/);
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 390, height: 320 });
  try {
    option.animation = false;
    option.dataZoom[0].throttle = 0;
    chart.setOption(option);
    // zrender convierte touchstart/touchmove en mousedown/mousemove.
    // Simula esa ruta, sin afirmar que reproduce el scroll del navegador.
    let dragPrevented = false;
    const dragEvent = { button: 0, preventDefault() { dragPrevented = true; }, stopPropagation() {} };
    chart.getZr().trigger('mousedown', { event: dragEvent, offsetX: 180, offsetY: 100 });
    chart.getZr().trigger('mousemove', { event: dragEvent, offsetX: 190, offsetY: 150 });
    chart.getZr().trigger('mouseup', { event: dragEvent, offsetX: 190, offsetY: 150 });
    assert.equal(dragPrevented, false);
    assert.equal(chart.getOption().dataZoom[0].start, 0);
    assert.equal(chart.getOption().dataZoom[0].end, 100);
    for (const ctrlKey of [false, true]) {
      let stopped = false;
      let prevented = false;
      const event = { ctrlKey, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } };
      view.preservePageScroll(event);
      assert.equal(stopped, !ctrlKey);
      assert.equal(prevented, false);
      if (!stopped) chart.getZr().trigger('mousewheel', { event, wheelDelta: 1, offsetX: 180, offsetY: 100 });
      const zoom = chart.getOption().dataZoom[0];
      if (ctrlKey) {
        assert.ok(zoom.end - zoom.start < 100, 'Ctrl+rueda reduce el intervalo visible');
      } else {
        assert.equal(zoom.end - zoom.start, 100);
        assert.equal(prevented, false);
      }
    }
  } finally { chart.dispose(); }
});

test('ECharts real: resize conserva nombres y zoom; zoom no elimina datos', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 390, height: 320 });
  try {
    const { option } = setup();
    option.animation = false;
    chart.setOption(option);
    assert.equal(chart.getOption().legend[0].data.filter(Boolean).length, 4);
    assert.equal(chart.getOption().grid[0].bottom, 88);
    chart.dispatchAction({ type: 'dataZoom', start: 25, end: 75 });
    for (const width of [390, 720, 900, 1200, 1600, 328]) {
      chart.resize({ width });
      const current = chart.getOption();
      assert.deepEqual(current.legend[0].data.filter(Boolean), names);
      assert.equal(current.grid[0].bottom, width <= 600 ? 88 : 64);
      assert.equal(current.dataZoom[0].start, 25);
      assert.equal(current.xAxis[0].axisLabel.hideOverlap, true);
      assert.equal(current.yAxis[0].axisLabel.hideOverlap, true);
      const legend = chart.getViewOfComponentModel(chart.getModel().getComponent('legend'));
      assert.ok(legend.group.getBoundingRect().width <= width, `leyenda dentro de ${width}px en SSR`);
      assert.ok(legend.group.getBoundingRect().height < current.grid[0].bottom - 24);
      current.series.forEach((s, i) => assert.deepEqual(s.data, buckets.map(p => p[fields[i]])));
      for (let i = 0; i < 4; i++) {
        assert.equal(chart.getModel().getSeriesByIndex(i).getData().count(), buckets.length);
      }
    }
  } finally { chart.dispose(); }
});
