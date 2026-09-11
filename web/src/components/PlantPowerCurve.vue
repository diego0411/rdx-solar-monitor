<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { apiFetch } from '../services/api.js';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
const props = defineProps({ plantId: { type: String, required: true }, timezone: String });
const today = new Date();
const selectedDate = ref(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
const points = ref([]), loading = ref(false), error = ref(''), container = ref(null);
const chartWidth = ref(0), chartHeight = ref(0), chartReady = ref(false);
let chart, observer;
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
  chartReady.value = false;
}
function render() {
  if (!container.value || !points.value.length) return;
  if (!chart) {
    chart = echarts.init(container.value);
    chartReady.value = true;
    observer = new ResizeObserver(entries => {
      chartWidth.value = Math.round(entries[0]?.contentRect.width ?? container.value?.clientWidth ?? 0);
      chartHeight.value = Math.round(entries[0]?.contentRect.height ?? container.value?.clientHeight ?? 0);
      chart?.resize();
    });
    observer.observe(container.value);
  }
  chartWidth.value = container.value.clientWidth;
  chartHeight.value = container.value.clientHeight;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('es-BO', { timeZone: props.timezone || undefined, hour: '2-digit', minute: '2-digit' });
  } catch {
    formatter = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit' });
  }
  chart.setOption({
    color: ['#174d3c', '#d08a22', '#447bb1', '#9070ac'],
    tooltip: { trigger: 'axis', renderMode: 'richText', valueFormatter: value => value == null ? 'Sin datos' : new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(value) + ' W' },
    legend: { type: 'scroll', bottom: 0, textStyle: { color: '#52665b', fontSize: 12 }, itemGap: 20 },
    grid: { left: 64, right: 20, top: 45, bottom: 80 },
    xAxis: { type: 'category', data: points.value.map(point => point.interval_start), axisLabel: { color: '#52665b', hideOverlap: true, formatter: value => formatter.format(new Date(value)) }, axisLine: { lineStyle: { color: '#d7e2da' } }, axisTick: { show: false } },
    yAxis: { type: 'value', name: 'Potencia (W)', axisLabel: { color: '#52665b' }, splitLine: { lineStyle: { color: '#e8eee9', type: 'dashed' } } },
    series: seriesFields.map(([key, name]) => ({
      name, type: 'line', showSymbol: false, connectNulls: false,
      data: points.value.map(point => point[key] ?? null),
    })),
  }, { notMerge: true });
}
watch(() => [props.plantId, selectedDate.value], async ([id, day], previous, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  points.value = [];
  error.value = '';
  if (!day) { loading.value = false; return; }
  loading.value = true;
  try {
    const data = await apiFetch(`/plants/${encodeURIComponent(id)}/power-history?${new URLSearchParams({ startTime: day })}`, { signal: controller.signal });
    if (!Array.isArray(data)) throw new Error('Respuesta inválida');
    if (!controller.signal.aborted) points.value = [...data].sort((a, b) => Date.parse(a.interval_start) - Date.parse(b.interval_start));
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
watch(() => props.timezone, render);
onBeforeUnmount(dispose);
</script>

<template>
  <section class="card power-section" aria-labelledby="power-title">
    <div class="power-header">
      <h2 id="power-title">Curva de potencia</h2>
      <label>Fecha <input v-model="selectedDate" type="date" /></label>
    </div>
    <p role="status">DEBUG points={{ points.length }} · container={{ chartWidth }}×{{ chartHeight }} · chart={{ chartReady ? 'sí' : 'no' }}</p>
    <p v-if="loading" role="status">Cargando curva de potencia…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <p v-else-if="!selectedDate">Selecciona una fecha.</p>
    <p v-else-if="!points.length" role="status">No hay datos de potencia para la fecha seleccionada.</p>
    <div v-else ref="container" class="power-chart" role="img" aria-label="Curva diaria de generación, consumo, importación y exportación de red en W"></div>
  </section>
</template>

<style scoped>
.power-section { min-width: 0; }
.power-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 24px; }
h2 { margin: 0; font-size: 21px; letter-spacing: -.02em; }
label { display: flex; align-items: center; gap: 10px; font-size: 14px; }
input { padding: 9px 12px; border: 1px solid #cad8ce; border-radius: 7px; color: #243b32; background: white; font: inherit; }
input:focus-visible { outline: 2px solid #529b79; outline-offset: 2px; }
.power-chart { width: 100%; height: 380px; }
@media (max-width: 600px) {
  .power-section { padding: 20px 12px; }
  .power-header { padding: 0 8px; gap: 16px; }
  label { width: 100%; justify-content: space-between; }
  input { min-width: 0; max-width: 100%; }
  .power-chart { height: 320px; }
}
</style>
