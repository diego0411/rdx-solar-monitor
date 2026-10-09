import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed, mergeModels } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { resolveChartTimeZone } from '../src/utils/chartTimezone.js';

const source = readFileSync(new URL('../src/components/PlantPowerCurve.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'power-curve-test' }).content
  .replace(/^import .*;?$/gm, '').replace('export default', 'return');
const fields = ['generation_power_w', 'consumption_power_w', 'grid_import_power_w', 'grid_export_power_w'];
const names = ['Generación', 'Consumo', 'Importación de red', 'Exportación de red'];
const buckets = Array.from({ length: 24 }, (_, i) => ({
  interval_start: new Date(Date.UTC(2026, 9, 9, i)).toISOString(),
  generation_power_w: i === 3 ? null : i * 123.45,
  consumption_power_w: i * 97,
  grid_import_power_w: i === 6 ? null : 0,
  grid_export_power_w: i * 3,
}));

function setup(period = 'day') {
  let option;
  const deps = {
    ref, computed, _mergeModels: mergeModels, watch() {}, onMounted() {}, onBeforeUnmount() {},
    _useModel: (props, key) => ref(props[key]),
    echarts: { use() {}, init: () => ({ setOption(value) { option = value; } }) },
    LineChart, DataZoomComponent, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer: {},
    ResizeObserver: class { observe() {} }, apiFetch() { throw new Error('Unexpected fetch'); },
    rdxColor: name => name, resolveChartTimeZone,
  };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({ plantId: 'p1', selectedDate: '2026-10-09', period, timezone: 'GMT-4' }, { expose() {} });
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
      assert.equal(series.smooth, .18);
      assert.equal(series.connectNulls, false);
      assert.equal(series.sampling, undefined);
      assert.equal(series.stack, undefined);
    });
    assert.deepEqual(view.points.value, buckets);
  }
});

test('jerarquía, tokens y zoom inside sin filtrado ni slider', () => {
  const { option } = setup();
  assert.deepEqual(option.color, ['--rdx-chart-green', '--rdx-chart-amber', '--rdx-chart-blue', '--rdx-chart-purple']);
  assert.deepEqual(option.series.map(s => s.lineStyle.width), [2.5, 2, 1.5, 1.5]);
  assert.deepEqual(option.series.map(s => s.lineStyle.type ?? 'solid'), ['solid', 'solid', 'dashed', 'dotted']);
  assert.deepEqual(option.series.map(s => s.areaStyle?.opacity), [.12, undefined, undefined, undefined]);
  assert.deepEqual(option.dataZoom, [{
    type: 'inside', xAxisIndex: [0], filterMode: 'none',
    preventDefaultMouseMove: false,
    zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, moveOnMouseMove: false,
  }]);
  assert.equal(option.tooltip.confine, true);
  assert.equal(option.yAxis.name, 'Potencia (kW)');
  assert.equal(option.yAxis.axisLabel.formatter(2500), new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(2.5));
});

test('tooltip individual mantiene W/kW y Sin datos sin totales', () => {
  const { option } = setup();
  const result = option.tooltip.formatter(names.map((seriesName, i) => ({ seriesName, axisValue: buckets[0].interval_start, data: [1250, 25, null, 0][i] })));
  assert.equal(result.split('\n').length, 5);
  assert.ok(result.includes(`Generación: ${new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1.25)} kW`));
  assert.ok(result.includes('Consumo: 25 W'));
  assert.ok(result.includes('Importación de red: Sin datos'));
  assert.ok(result.includes('Exportación de red: 0 W'));
});

test('aria-label refleja el período seleccionado', () => {
  for (const [period, label] of [['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']]) {
    assert.equal(setup(period).view.periodLabel.value, label);
  }
  assert.match(source, /:aria-label="`Curva de potencia \(\$\{periodLabel\}\)/);
});

echarts.use([LineChart, DataZoomComponent, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);
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
    for (const width of [1600, 390, 768]) {
      chart.resize({ width });
      const current = chart.getOption();
      assert.deepEqual(current.legend[0].data.filter(Boolean), names);
      assert.equal(current.grid[0].bottom, width <= 600 ? 88 : 64);
      assert.equal(current.dataZoom[0].start, 25);
      current.series.forEach((s, i) => assert.deepEqual(s.data, buckets.map(p => p[fields[i]])));
      assert.equal(chart.getModel().getSeriesByIndex(0).getData().count(), buckets.length);
    }
  } finally { chart.dispose(); }
});
