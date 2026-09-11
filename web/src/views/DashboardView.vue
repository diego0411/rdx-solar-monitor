<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { apiFetch } from '../services/api.js';

const summary = ref(null);
const loading = ref(true);
const error = ref('');
const syncLoading = ref(false);
const syncError = ref('');
const syncResult = ref(null);
const controller = new AbortController();
const formatter = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 });
const groups = [
  { title: 'Plantas', metrics: [
    ['total_plants', 'Total de plantas'], ['online_plants', 'En línea'],
    ['offline_plants', 'Sin conexión'], ['alarm_plants', 'Con alarma'],
  ] },
  { title: 'Producción', metrics: [
    ['total_capacity_kwp', 'Capacidad instalada', 'kWp'],
    ['current_generation_power_w', 'Generación actual', 'W'],
    ['current_consumption_power_w', 'Consumo actual', 'W'],
    ['current_grid_import_power_w', 'Importación de red', 'W'],
    ['current_grid_export_power_w', 'Exportación de red', 'W'],
  ] },
  { title: 'Energía', metrics: [
    ['today_generation_kwh', 'Generación de hoy', 'kWh'],
    ['month_generation_kwh', 'Generación del mes', 'kWh'],
    ['year_generation_kwh', 'Generación del año', 'kWh'],
    ['total_generation_kwh', 'Generación total', 'kWh'],
    ['today_consumption_kwh', 'Consumo de hoy', 'kWh'],
  ] },
  { title: 'Dispositivos', metrics: [
    ['total_devices', 'Total de dispositivos'], ['online_devices', 'En línea'],
    ['offline_devices', 'Sin conexión'], ['unknown_devices', 'Estado desconocido'],
  ] },
];
const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };
const providerGroups = [
  { title: 'Plantas', metrics: [
    ['total_plants', 'Total'], ['online_plants', 'En línea'],
    ['offline_plants', 'Sin conexión'], ['alarm_plants', 'Con alarma'],
  ] },
  { title: 'Dispositivos', metrics: [
    ['total_devices', 'Total'], ['online_devices', 'En línea'],
    ['offline_devices', 'Sin conexión'], ['unknown_devices', 'Desconocido'],
  ] },
];
const hyxiInventoryMetrics = [
  ['total_plants', 'Plantas'],
  ['inverter_devices', 'Inversores'],
  ['communication_devices', 'Dispositivos de comunicación'],
  ['total_devices', 'Total dispositivos HYXi'],
];
const hyxiDeviceGroups = [
  { title: 'Inversores', metrics: [
    ['inverter_total', 'Total'], ['inverter_online', 'En línea'],
    ['inverter_offline', 'Sin conexión'], ['inverter_alarm', 'Con alarma'],
  ] },
  { title: 'Comunicación', metrics: [
    ['communication_total', 'Total'], ['communication_online', 'En línea'],
    ['communication_offline', 'Sin conexión'], ['communication_alarm', 'Con alarma'],
  ] },
];

function formatValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? formatter.format(value) : '—';
}

async function syncGrowatt() {
  if (syncLoading.value) return;
  syncLoading.value = true;
  syncError.value = '';
  syncResult.value = null;
  try {
    syncResult.value = await apiFetch('/integrations/growatt/sync/latest', { method: 'POST' });
  } catch {
    syncError.value = 'No se pudo ejecutar la sincronización Growatt.';
  } finally {
    syncLoading.value = false;
  }
}

onMounted(async () => {
  try {
    const data = await apiFetch('/dashboard/summary', { signal: controller.signal });
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Respuesta inválida');
    summary.value = data;
  } catch {
    if (!controller.signal.aborted) error.value = 'No se pudo cargar el resumen. Comprueba la conexión con el servidor y vuelve a cargar la página.';
  } finally {
    loading.value = false;
  }
});
onUnmounted(() => controller.abort());
</script>

<template>
  <header class="page-header">
    <p class="eyebrow">RDX Solar Monitor</p>
    <h1>Dashboard</h1>
    <p>Una vista general de tu energía solar.</p>
  </header>
  <div v-if="loading" class="card" role="status" aria-live="polite">
    <p>Cargando resumen…</p>
  </div>
  <div v-else-if="error" class="card error-state" role="alert">
    <h2>No se pudo cargar el dashboard</h2>
    <p>{{ error }}</p>
  </div>
  <div v-else-if="summary" class="dashboard-groups">
    <section class="sync-panel" aria-labelledby="growatt-sync-title">
      <div>
        <h2 id="growatt-sync-title" class="group-title">Sincronización Growatt</h2>
        <p v-if="syncError" class="sync-error" role="alert">{{ syncError }}</p>
        <dl v-if="syncResult" class="sync-results">
          <div><dt>Procesados</dt><dd>{{ syncResult.processed }}</dd></div>
          <div><dt>Actualizados</dt><dd>{{ syncResult.updated }}</dd></div>
          <div><dt>Sin datos</dt><dd>{{ syncResult.no_data }}</dd></div>
          <div><dt>Fallidos</dt><dd>{{ syncResult.failed }}</dd></div>
        </dl>
        <ul v-if="syncResult?.errors?.length" class="sync-errors">
          <li v-for="(syncItem, index) in syncResult.errors" :key="index">{{ syncItem.error_message }}</li>
        </ul>
      </div>
      <button type="button" class="sync-button" :disabled="syncLoading" @click="syncGrowatt">
        {{ syncLoading ? 'Sincronizando…' : 'Sync Growatt' }}
      </button>
    </section>
    <section v-for="(group, index) in groups" :key="group.title" :aria-labelledby="`group-${index}`">
      <h2 :id="`group-${index}`" class="group-title">{{ group.title }}</h2>
      <div class="metrics-grid">
        <article v-for="[key, label, unit] in group.metrics" :key="key" class="card metric-card">
          <h3>{{ label }}</h3>
          <p class="metric-value">{{ formatValue(summary[key]) }} <span v-if="unit" class="metric-unit">{{ unit }}</span></p>
        </article>
      </div>
    </section>
    <section aria-labelledby="providers-title">
      <h2 id="providers-title" class="group-title">Resumen por proveedor</h2>
      <div v-if="summary.providers?.length" class="providers-grid">
        <article v-for="provider in summary.providers" :key="provider.provider" class="card provider-card">
          <h3 class="provider-title">{{ providerNames[provider.provider] ?? provider.provider }}</h3>
          <div v-if="provider.provider === 'hyxi'" class="provider-group">
            <h4>Inventario HYXi</h4>
            <dl class="provider-metrics">
              <div v-for="[key, label] in hyxiInventoryMetrics" :key="key">
                <dt>{{ label }}</dt><dd>{{ formatValue(provider[key]) }}</dd>
              </div>
            </dl>
          </div>
          <template v-if="provider.provider === 'hyxi'">
            <div v-for="group in hyxiDeviceGroups" :key="group.title" class="provider-group">
              <h4>{{ group.title }}</h4>
              <dl class="provider-metrics">
                <div v-for="[key, label] in group.metrics" :key="key">
                  <dt>{{ label }}</dt><dd>{{ formatValue(provider[key]) }}</dd>
                </div>
              </dl>
            </div>
          </template>
          <div v-for="group in providerGroups.filter(group => provider.provider !== 'hyxi' || group.title !== 'Dispositivos')" :key="group.title" class="provider-group">
            <h4>{{ group.title }}</h4>
            <dl class="provider-metrics">
              <div v-for="[key, label] in group.metrics" :key="key">
                <dt>{{ label }}</dt><dd>{{ formatValue(provider[key]) }}</dd>
              </div>
            </dl>
          </div>
        </article>
      </div>
      <p v-else class="card">No hay información por proveedor disponible.</p>
    </section>
  </div>
</template>

<style scoped>
.dashboard-groups { display: grid; gap: 32px; }
.sync-panel { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding: 20px 24px; background: #edf4ef; border: 1px solid #cddfd2; border-radius: 10px; }
.sync-panel .group-title { margin-bottom: 8px; }
.sync-panel p { margin: 0; }
.sync-button { flex: 0 0 auto; border: 0; border-radius: 8px; padding: 11px 16px; background: #174d3c; color: white; font: inherit; font-weight: 600; cursor: pointer; }
.sync-button:disabled { opacity: .6; cursor: default; }
.sync-results { display: grid; grid-template-columns: repeat(4, minmax(72px, 1fr)); gap: 16px; margin: 12px 0 0; }
.sync-results dt { color: #5b6d63; font-size: 12px; }
.sync-results dd { margin: 2px 0 0; color: #174d3c; font-size: 20px; font-weight: 700; }
.sync-errors { margin: 12px 0 0; padding-left: 18px; color: #963d2a; font-size: 13px; }
.sync-error { color: #963d2a; }
.group-title { margin: 0 0 14px; font-size: 18px; }
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 16px; }
.metric-card { padding: 24px; min-width: 0; }
.metric-card h3 { margin: 0 0 14px; font-size: 14px; font-weight: 500; color: #5b6d63; }
.metric-card .metric-value { color: #174d3c; font-size: clamp(24px, 2.5vw, 32px); font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.metric-unit { font-size: 14px; font-weight: 500; white-space: nowrap; }
.error-state { border-color: #d8bcb4; }
.error-state h2 { margin-top: 0; }
.providers-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 16px; }
.provider-card { padding: 24px; min-width: 0; }
.provider-title { margin: 0 0 20px; color: #174d3c; font-size: 20px; }
.provider-group + .provider-group { border-top: 1px solid #dfe7e1; margin-top: 20px; padding-top: 20px; }
.provider-group h4 { margin: 0 0 12px; font-size: 14px; }
.provider-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 0; }
.provider-metrics dt { font-size: 13px; color: #5b6d63; }
.provider-metrics dd { margin: 4px 0 0; font-weight: 700; font-size: 22px; color: #174d3c; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
@media (max-width: 600px) { .sync-panel { flex-direction: column; } .sync-button { width: 100%; } .sync-results { grid-template-columns: repeat(2, minmax(72px, 1fr)); } }
</style>
