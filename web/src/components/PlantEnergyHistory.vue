<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { apiFetch } from '../services/api.js';
import { rdxColor, CHART_SERIES_COLORS } from '../utils/rdxTokens.js';

echarts.use([BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
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
  try {
    formatter = new Intl.DateTimeFormat('es-BO', { timeZone: props.timezone || undefined, hour: '2-digit', minute: '2-digit' });
  } catch {
    formatter = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit' });
  }
  const labelFormatter = value => {
    const instant = new Date(value);
    if (period.value === 'year') {
      return new Intl.DateTimeFormat('es-BO', { month: 'short', timeZone: props.timezone || undefined }).format(instant);
    }
    if (period.value === 'month') {
      return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', timeZone: props.timezone || undefined }).format(instant);
    }
    if (period.value === 'day') return formatter.format(instant);
    return new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(instant);
  };
  chart.setOption({
    color: [rdxColor('--rdx-primary'), ...CHART_SERIES_COLORS],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, renderMode: 'richText', backgroundColor: rdxColor('--rdx-surface'), borderColor: rdxColor('--rdx-border'), textStyle: { color: rdxColor('--rdx-text'), fontSize: 12 }, valueFormatter: value => value == null ? 'Sin datos' : new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(value) + ' kWh' },
    legend: { type: 'scroll', bottom: 0, icon: 'circle', textStyle: { color: rdxColor('--rdx-text-muted'), fontSize: 12 }, itemGap: 24 },
    grid: { left: 58, right: 16, top: 24, bottom: 64 },
    xAxis: { type: 'category', data: points.value.map(point => point.interval_start), axisLabel: { color: rdxColor('--rdx-text-muted'), hideOverlap: true, formatter: labelFormatter }, axisLine: { lineStyle: { color: rdxColor('--rdx-border') } }, axisTick: { show: false } },
    yAxis: { type: 'value', name: 'Energía (kWh)', axisLabel: { color: rdxColor('--rdx-text-muted') }, splitLine: { lineStyle: { color: rdxColor('--rdx-border'), type: 'dashed' } } },
    series: seriesFields.map(([key, name]) => ({
      name, type: 'bar', barMaxWidth: 26, emphasis: { focus: 'series' },
      data: points.value.map(point => point[key] ?? null),
    })),
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
      points.value = [...data.buckets].sort((a, b) => Date.parse(a.interval_start) - Date.parse(b.interval_start));
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
    <div v-else ref="container" class="energy-chart" role="img" aria-label="Curva diaria de generación, consumo, importación y exportación de red en kWh"></div>
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
