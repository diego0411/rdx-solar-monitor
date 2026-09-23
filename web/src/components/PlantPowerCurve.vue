<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { apiFetch } from '../services/api.js';
import { rdxColor, CHART_SERIES_COLORS } from '../utils/rdxTokens.js';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
const props = defineProps({ plantId: { type: String, required: true }, timezone: String });
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
  ['generation_power_w', 'Generación'],
  ['consumption_power_w', 'Consumo'],
  ['grid_import_power_w', 'Importación de red'],
  ['grid_export_power_w', 'Exportación de red'],
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
  chart.setOption({
    color: [rdxColor('--rdx-primary'), ...CHART_SERIES_COLORS],
    tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: rdxColor('--rdx-surface'), borderColor: rdxColor('--rdx-border'), textStyle: { color: rdxColor('--rdx-text'), fontSize: 12 }, valueFormatter: value => value == null ? 'Sin datos' : new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(value) + ' W' },
    legend: { type: 'scroll', bottom: 0, icon: 'circle', textStyle: { color: rdxColor('--rdx-text-muted'), fontSize: 12 }, itemGap: 24 },
    grid: { left: 60, right: 16, top: 26, bottom: 64 },
    xAxis: { type: 'category', data: points.value.map(point => point.interval_start), axisLabel: { color: rdxColor('--rdx-text-muted'), hideOverlap: true, formatter: value => period.value === 'day' ? formatter.format(new Date(value)) : new Intl.DateTimeFormat('es-BO', period.value === 'year' ? { month: 'short', timeZone: 'UTC' } : { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(value)) }, axisLine: { lineStyle: { color: rdxColor('--rdx-border') } }, axisTick: { show: false } },
    yAxis: { type: 'value', name: 'Potencia (W)', axisLabel: { color: rdxColor('--rdx-text-muted') }, splitLine: { lineStyle: { color: rdxColor('--rdx-border'), type: 'dashed' } } },
    series: seriesFields.map(([key, name]) => ({
      name, type: 'line', showSymbol: false, connectNulls: false, smooth: .18, lineStyle: { width: 2 },
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
    const data = await apiFetch(`/plants/${encodeURIComponent(id)}/power-history?${new URLSearchParams({ startTime: day, period: selectedPeriod })}`, { signal: controller.signal });
    if (!Array.isArray(data?.buckets)) throw new Error('Respuesta inválida');
    if (!controller.signal.aborted) points.value = [...data.buckets].sort((a, b) => Date.parse(a.interval_start) - Date.parse(b.interval_start));
  } catch (failure) {
    if (!controller.signal.aborted) {
      error.value = failure.status === 401
        ? 'Tu sesión no está autenticada. Inicia sesión nuevamente para cargar la curva de potencia.'
        : 'No se pudo cargar la curva de potencia. Comprueba la conexión o selecciona otra fecha.';
    }
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
  <section class="card power-section" aria-labelledby="power-title">
    <div class="power-header">
      <div>
        <h2 id="power-title">Curva de potencia</h2>
        <p>Evolución de la potencia durante el periodo seleccionado</p>
      </div>
      <div class="period-controls">
        <div class="segmented" aria-label="Periodo de curva de potencia">
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
    <p v-if="loading" role="status">Cargando curva de potencia…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!selectedDate">Selecciona una fecha.</p>
    <p v-else-if="!points.length" role="status">No hay datos de potencia para la fecha seleccionada.</p>
    <div v-else ref="container" class="power-chart" role="img" aria-label="Curva diaria de generación, consumo, importación y exportación de red en W"></div>
  </section>
</template>

<style scoped>
.power-section { min-width: 0; }
.power-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 14px; margin-bottom: 12px; }
h2 { margin: 0; font-size: 17px; letter-spacing: -.015em; }
.power-header p { margin: 2px 0 0; color: var(--rdx-text-muted); font-size: 11px; }
.period-controls { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.segmented { display: flex; gap: 4px; padding: 3px; border-radius: var(--rdx-radius-sm); background: var(--rdx-background); }
.segmented button { min-height: 30px; padding: 5px 11px; border: 0; border-radius: 5px; background: transparent; color: var(--rdx-text-muted); font: inherit; font-size: 11px; cursor: pointer; }
.segmented button.active { background: var(--rdx-primary); color: white; }
.segmented button:disabled { opacity: .42; cursor: not-allowed; }
label { display: flex; align-items: center; gap: 8px; color: var(--rdx-text-muted); font-size: 12px; }
input { width: auto; }
.power-chart { width: 100%; height: 320px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 600px) {
  .power-section { padding: 20px 12px; }
  .power-header { padding: 0 8px; gap: 16px; }
  .period-controls, label, input { width: 100%; }
  .segmented { width: 100%; overflow: hidden; }
  .segmented button { flex: 1; min-width: 0; padding-inline: 4px; }
  input { min-width: 0; max-width: 100%; }
  .power-chart { height: 320px; }
}
</style>
