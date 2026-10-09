<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { apiFetch } from '../services/api.js';
import { rdxColor } from '../utils/rdxTokens.js';
import { resolveChartTimeZone } from '../utils/chartTimezone.js';
import { toVisualEnergyPoint } from '../utils/energyHistoryChart.js';

echarts.use([BarChart, LineChart, DataZoomComponent, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
const props = defineProps({ plantId: { type: String, required: true }, timezone: String });
const emit = defineEmits(['history-loaded']);
const selectedDate = defineModel('selectedDate', { type: String, required: true });
const period = defineModel('period', { default: 'day' });
const points = ref([]), loading = ref(false), error = ref(''), container = ref(null);
let chart, observer;
const periods = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'year', label: 'Año' },
];
const seriesFields = [
  ['generation_kwh', 'Generación'],
  ['consumption_kwh', 'Consumo'],
  ['grid_import_kwh', 'Importación de red'],
  ['grid_export_kwh', 'Exportación de red'],
];
const periodLabel = computed(() => periods.find(item => item.key === period.value)?.label ?? '');
// Mismo comportamiento de UX-04B2: rueda normal para la página, Ctrl para zoom.
// ECharts cancela wheel antes de comprobar zoomOnMouseWheel.
function preservePageScroll(event) {
  if (!event.ctrlKey) event.stopPropagation();
}
function dispose() {
  observer?.disconnect();
  chart?.dispose();
  observer = null;
  chart = null;
}
function render() {
  if (!container.value || !points.value.length) return;
  if (!chart) {
    chart = echarts.init(container.value);
    observer = new ResizeObserver(() => chart?.resize());
    observer.observe(container.value);
  }
  let formatter;
  const timeZone = resolveChartTimeZone(props.timezone);
  try {
    formatter = new Intl.DateTimeFormat('es-BO', { timeZone, hour: '2-digit', minute: '2-digit' });
  } catch {
    formatter = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit' });
  }
  const labelFormatter = value => {
    const instant = new Date(value);
    if (period.value === 'year') {
      return new Intl.DateTimeFormat('es-BO', { month: 'short', timeZone }).format(instant);
    }
    if (period.value === 'month') {
      return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', timeZone }).format(instant);
    }
    if (period.value === 'day') return formatter.format(instant);
    return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(instant);
  };
  chart.setOption({
    color: [rdxColor('--rdx-chart-green'), rdxColor('--rdx-chart-amber'), rdxColor('--rdx-chart-blue'), rdxColor('--rdx-chart-purple')],
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' }, renderMode: 'richText', confine: true,
      backgroundColor: rdxColor('--rdx-surface'), borderColor: rdxColor('--rdx-border'),
      textStyle: { color: rdxColor('--rdx-text'), fontSize: 12 },
      formatter: params => {
        const item = Array.isArray(params) ? params[0] : params;
        const point = points.value[item?.dataIndex];
        if (!point) return '';
        const number = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 });
        // Leer el punto original conserva los cuatro valores, incluidos nulos
        // que ECharts puede omitir de los parámetros del tooltip mixto.
        return [labelFormatter(point.interval_start), ...seriesFields.map(([key, name]) =>
          `${name}: ${point[key] == null ? 'Sin datos' : number.format(point[key]) + ' kWh'}`,
        )].join('\n');
      },
    },
    legend: { type: 'plain', bottom: 0, left: 'center', data: seriesFields.map(([, name]) => name), textStyle: { color: rdxColor('--rdx-text'), fontSize: 12 }, itemWidth: 18, itemHeight: 8, itemGap: 20 },
    grid: { left: 58, right: 16, top: 24, bottom: 64 },
    dataZoom: [{
      type: 'inside', xAxisIndex: [0], filterMode: 'none',
      preventDefaultMouseMove: false,
      zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false, moveOnMouseMove: false,
    }],
    xAxis: { type: 'category', data: points.value.map(point => point.interval_start), axisLabel: { color: rdxColor('--rdx-text-muted'), fontSize: 12, hideOverlap: true, formatter: labelFormatter }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', name: 'Energía (kWh)', nameTextStyle: { color: rdxColor('--rdx-text-muted'), fontSize: 12 }, axisLabel: { color: rdxColor('--rdx-text-muted'), fontSize: 12, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: rdxColor('--rdx-border'), opacity: .6, type: 'dashed' } } },
    // Las cuatro magnitudes son kWh por bucket, sobre el mismo eje y sin apilar.
    // '0%' evita el mínimo de 1 px; ECharts interpreta el número 0 como ausente.
    series: seriesFields.map(([key, name], index) => ({
      name, emphasis: { focus: 'series' },
      ...(index < 2
        ? { type: 'bar', barMinWidth: '0%', barMaxWidth: 24, barGap: '20%', barCategoryGap: '35%' }
        : { type: 'line', smooth: false, connectNulls: false, showSymbol: true, symbolSize: 4,
          lineStyle: { width: 1.5, type: index === 2 ? 'dashed' : 'dotted' }, z: 3 }),
      data: points.value.map(point => point[key] ?? null),
    })),
    media: [
      { query: { maxWidth: 600 }, option: {
        legend: { itemGap: 12, data: [seriesFields[0][1], seriesFields[1][1], '', seriesFields[2][1], seriesFields[3][1]] },
        grid: { bottom: 88 },
        xAxis: { axisLabel: { fontSize: 11 } },
        yAxis: { axisLabel: { fontSize: 11 }, nameTextStyle: { fontSize: 11 } },
      } },
      { option: {
        legend: { itemGap: 20, data: seriesFields.map(([, name]) => name) },
        grid: { bottom: 64 },
        xAxis: { axisLabel: { fontSize: 12 } },
        yAxis: { axisLabel: { fontSize: 12 }, nameTextStyle: { fontSize: 12 } },
      } },
    ],
  }, { notMerge: true });
}
watch(() => [props.plantId, selectedDate.value, period.value], async ([id, day, selectedPeriod], previous, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  points.value = [];
  error.value = '';
  if (!day) { loading.value = false; return; }
  loading.value = true;
  try {
    const timeType = selectedPeriod === 'month' ? '2' : selectedPeriod === 'year' ? '3' : '1';
    const data = await apiFetch(`/plants/${encodeURIComponent(id)}/energy-history?${new URLSearchParams({ timeType, startTime: day, period: selectedPeriod })}`, { signal: controller.signal });
    if (!Array.isArray(data?.buckets)) throw new Error('Respuesta inválida');
    if (!controller.signal.aborted) {
      const sorted = [...data.buckets]
        .sort((a, b) => Date.parse(a.interval_start) - Date.parse(b.interval_start));
      points.value = selectedPeriod === 'day' ? sorted.map(toVisualEnergyPoint) : sorted;
      emit('history-loaded', data);
    }
  } catch {
    if (!controller.signal.aborted) error.value = 'No se pudo cargar la histórico energético. Comprueba la conexión o selecciona otra fecha.';
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}, { immediate: true });
watch(container, () => { dispose(); render(); }, { flush: 'post' });
watch(points, render, { flush: 'post' });
watch(() => props.timezone, render);
// UX-01C: los colores se resuelven por token en cada render; al cambiar el
// tema se re-renderiza (applyTheme ya invalidó la caché). Sin refetch.
function renderOnThemeChange() { render(); }
onMounted(() => {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('rdx:theme', renderOnThemeChange);
  }
});
onBeforeUnmount(() => {
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener('rdx:theme', renderOnThemeChange);
  }
});
onBeforeUnmount(dispose);
</script>

<template>
  <section class="card energy-section" aria-labelledby="energy-history-title">
    <div class="energy-header">
      <div>
        <h2 id="energy-history-title">Histórico energético</h2>
        <p>Generación, consumo e intercambio con la red</p>
      </div>
      <div class="period-controls">
        <div class="segmented" aria-label="Periodo del histórico energético">
          <button
            v-for="item in periods"
            :key="item.key"
            type="button"
            :class="{ active: period === item.key }"
            @click="period = item.key"
          >
            {{ item.label }}
          </button>
        </div>
        <label><span class="sr-only">Fecha</span><input v-model="selectedDate" type="date" /></label>
      </div>
    </div>
    <p v-if="loading" role="status">Cargando histórico energético…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!selectedDate">Selecciona una fecha.</p>
    <p v-else-if="!points.length" role="status">No hay datos de energía para la fecha seleccionada.</p>
    <div v-else ref="container" class="energy-chart" role="img" @wheel.capture="preservePageScroll" :aria-label="`Histórico energético (${periodLabel}): generación, consumo, importación y exportación de red en kWh`"></div>
  </section>
</template>

<style scoped>
.energy-section { min-width: 0; padding: 20px; }
.energy-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
h2 { margin: 0; font-size: 17px; letter-spacing: -.015em; }
.energy-header p { margin: 2px 0 0; color: var(--rdx-text-muted); font-size: 11px; }
.period-controls { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.segmented { display: flex; gap: 4px; padding: 3px; border-radius: var(--rdx-radius-sm); background: var(--rdx-background); }
.segmented button { min-height: 30px; padding: 5px 11px; border: 0; border-radius: 5px; background: transparent; color: var(--rdx-text-muted); font: inherit; font-size: 11px; cursor: pointer; }
.segmented button.active { background: var(--rdx-primary); color: white; }
.segmented button:disabled { opacity: .42; cursor: not-allowed; }
label { display: flex; align-items: center; gap: 8px; color: var(--rdx-text-muted); font-size: 12px; }
input { width: auto; }
.energy-chart { width: 100%; height: 320px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 600px) {
  .energy-section { padding: 16px 12px; }
  .energy-header { padding: 0 8px; gap: 14px; }
  .period-controls, label, input { width: 100%; }
  .segmented { width: 100%; overflow: hidden; }
  .segmented button { flex: 1; min-width: 0; padding-inline: 4px; }
  input { min-width: 0; max-width: 100%; }
  .energy-chart { height: 300px; }
}
</style>
