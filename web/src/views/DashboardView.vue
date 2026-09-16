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

const primaryMetrics = [
  ['total_plants', 'Total plantas', 'neutral'],
  ['online_plants', 'En línea', 'online'],
  ['offline_plants', 'Sin conexión', 'offline'],
  ['alarm_plants', 'Con alarma', 'alarm'],
];
const energyMetrics = [
  ['total_capacity_kwp', 'Capacidad instalada', 'kWp'],
  ['current_generation_power_w', 'Generación actual', 'W'],
  ['current_consumption_power_w', 'Consumo actual', 'W'],
  ['current_grid_import_power_w', 'Importación de red', 'W'],
  ['current_grid_export_power_w', 'Exportación de red', 'W'],
  ['today_generation_kwh', 'Generación de hoy', 'kWh'],
  ['today_consumption_kwh', 'Consumo de hoy', 'kWh'],
  ['month_generation_kwh', 'Generación del mes', 'kWh'],
  ['year_generation_kwh', 'Generación del año', 'kWh'],
  ['total_generation_kwh', 'Generación total', 'kWh'],
];
const systemMetrics = [
  ['total_devices', 'Dispositivos'],
  ['online_devices', 'Dispositivos en línea', 'online'],
  ['offline_devices', 'Dispositivos sin conexión', 'offline'],
  ['unknown_devices', 'Estado desconocido', 'unknown'],
];
const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };
const providerMetrics = [
  ['total_plants', 'Plantas'],
  ['online_plants', 'Plantas en línea', 'online'],
  ['offline_plants', 'Plantas sin conexión', 'offline'],
  ['alarm_plants', 'Plantas con alarma', 'alarm'],
  ['total_devices', 'Dispositivos'],
  ['online_devices', 'Dispositivos en línea', 'online'],
  ['offline_devices', 'Dispositivos sin conexión', 'offline'],
  ['unknown_devices', 'Estado desconocido', 'unknown'],
];
const hyxiInventoryGroups = [
  { title: 'Inversores', metrics: [
    ['inverter_total', 'Total'], ['inverter_online', 'En línea', 'online'],
    ['inverter_offline', 'Sin conexión', 'offline'], ['inverter_alarm', 'Alarma', 'alarm'],
  ] },
  { title: 'Comunicación', metrics: [
    ['communication_total', 'Total'], ['communication_online', 'En línea', 'online'],
    ['communication_offline', 'Sin conexión', 'offline'], ['communication_alarm', 'Alarma', 'alarm'],
  ] },
];

function available(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
function formatValue(value) {
  return available(value) ? formatter.format(value) : '—';
}
function availableMetrics(source, metrics) {
  return metrics.filter(([key]) => available(source?.[key]));
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
  <div class="dashboard-view">
  <header class="dashboard-header">
    <div>
      <p class="eyebrow">RDX Solar Monitor</p>
      <h1>Resumen energético</h1>
      <p class="header-description">Estado operativo y desempeño de todas tus instalaciones solares.</p>
    </div>
    <div class="header-action">
      <span class="update-label">Actualización manual de telemetría</span>
      <button type="button" class="sync-button" :disabled="syncLoading" @click="syncGrowatt">
        {{ syncLoading ? 'Sincronizando…' : 'Sync Growatt' }}
      </button>
    </div>
  </header>

  <div v-if="loading" class="card page-state" role="status" aria-live="polite">Cargando resumen…</div>
  <div v-else-if="error" class="card page-state error-state" role="alert">
    <h2>No se pudo cargar el dashboard</h2>
    <p>{{ error }}</p>
  </div>

  <main v-else-if="summary" class="dashboard">
    <div v-if="syncError" class="sync-message sync-error" role="alert">{{ syncError }}</div>
    <div v-if="syncResult" class="sync-message" role="status">
      <strong>Growatt actualizado</strong>
      <span>Procesados {{ syncResult.processed }}</span>
      <span>Actualizados {{ syncResult.updated }}</span>
      <span>Sin datos {{ syncResult.no_data }}</span>
      <span>Fallidos {{ syncResult.failed }}</span>
      <ul v-if="syncResult.errors?.length">
        <li v-for="(syncItem, index) in syncResult.errors" :key="index">{{ syncItem.error_message }}</li>
      </ul>
    </div>

    <section class="primary-grid" aria-label="Estado general de plantas">
      <article v-for="[key, label, state] in primaryMetrics" :key="key" class="primary-kpi" :class="`kpi-${state}`">
        <span class="status-dot" aria-hidden="true"></span>
        <div><p>{{ label }}</p><strong>{{ formatValue(summary[key]) }}</strong></div>
      </article>
    </section>

    <section class="dashboard-section" aria-labelledby="energy-title">
      <div class="section-heading">
        <div><p class="section-kicker">Rendimiento</p><h2 id="energy-title">Energía</h2></div>
        <p>Producción, consumo y balance con la red.</p>
      </div>
      <dl class="energy-grid">
        <div v-for="[key, label, unit] in availableMetrics(summary, energyMetrics)" :key="key" class="energy-metric">
          <dt>{{ label }}</dt>
          <dd>{{ formatValue(summary[key]) }} <span>{{ unit }}</span></dd>
        </div>
      </dl>
    </section>

    <section class="dashboard-section" aria-labelledby="system-title">
      <div class="section-heading">
        <div><p class="section-kicker">Operación</p><h2 id="system-title">Estado del sistema</h2></div>
        <p>Disponibilidad general de plantas y equipos.</p>
      </div>
      <div class="system-layout">
        <dl class="system-metrics">
          <div v-for="[key, label, state] in availableMetrics(summary, systemMetrics)" :key="key">
            <dt><span v-if="state" class="mini-dot" :class="`dot-${state}`"></span>{{ label }}</dt>
            <dd>{{ formatValue(summary[key]) }}</dd>
          </div>
        </dl>
        <div class="system-note">
          <strong>{{ formatValue(summary.online_plants) }} de {{ formatValue(summary.total_plants) }}</strong>
          <span>plantas operando en línea</span>
        </div>
      </div>
    </section>

    <section v-if="summary.providers?.length" class="dashboard-section" aria-labelledby="providers-title">
      <div class="section-heading">
        <div><p class="section-kicker">Integraciones</p><h2 id="providers-title">Proveedores</h2></div>
        <p>Inventario y disponibilidad por plataforma.</p>
      </div>
      <div class="providers-grid">
        <article v-for="provider in summary.providers" :key="provider.provider" class="provider-panel">
          <header class="provider-header">
            <div><span class="provider-mark"></span><h3>{{ providerNames[provider.provider] ?? provider.provider }}</h3></div>
            <span>{{ formatValue(provider.total_plants) }} plantas</span>
          </header>
          <dl class="provider-overview">
            <div v-for="[key, label, state] in availableMetrics(provider, providerMetrics)" :key="key">
              <dt><span v-if="state" class="mini-dot" :class="`dot-${state}`"></span>{{ label }}</dt>
              <dd>{{ formatValue(provider[key]) }}</dd>
            </div>
          </dl>
          <div v-if="provider.provider === 'hyxi'" class="technical-inventory">
            <section v-for="group in hyxiInventoryGroups.filter(item => availableMetrics(provider, item.metrics).length)" :key="group.title">
              <h4>{{ group.title }}</h4>
              <dl>
                <div v-for="[key, label, state] in availableMetrics(provider, group.metrics)" :key="key">
                  <dt><span v-if="state" class="mini-dot" :class="`dot-${state}`"></span>{{ label }}</dt>
                  <dd>{{ formatValue(provider[key]) }}</dd>
                </div>
              </dl>
            </section>
          </div>
        </article>
      </div>
    </section>
  </main>
  </div>
</template>

<style scoped>
.dashboard-view { width: 100%; min-width: 0; }
:global(.main-content:has(.dashboard-view)) { max-width: none; min-width: 0; }
.dashboard-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin-bottom: 32px; padding-bottom: 28px; border-bottom: 1px solid #dfe7e1; }
.dashboard-header h1 { margin: 4px 0 8px; font-size: clamp(30px, 4vw, 44px); letter-spacing: -.04em; color: #173f33; }
.header-description { max-width: 620px; margin: 0; color: #617168; font-size: 16px; }
.header-action { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; }
.update-label { color: #718078; font-size: 12px; }
.sync-button { border: 0; border-radius: 9px; padding: 11px 17px; background: #174d3c; color: white; font: inherit; font-weight: 650; cursor: pointer; box-shadow: 0 5px 14px rgb(23 77 60 / 14%); }
.sync-button:hover:not(:disabled) { background: #0f3e30; }
.sync-button:disabled { opacity: .6; cursor: default; }
.dashboard { display: grid; width: 100%; min-width: 0; gap: 42px; }
.page-state { padding: 28px; }
.error-state { border-color: #dfc1b9; }
.error-state h2 { margin-top: 0; }
.sync-message { display: flex; flex-wrap: wrap; gap: 8px 20px; padding: 14px 18px; border-radius: 9px; background: #edf5f0; color: #315b4b; font-size: 13px; }
.sync-message ul { flex-basis: 100%; margin: 5px 0 0; padding-left: 18px; }
.sync-error { background: #fbece8; color: #8b3827; }
.primary-grid { display: grid; width: 100%; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
.primary-kpi { display: flex; align-items: flex-start; gap: 14px; min-width: 0; min-height: 132px; padding: 24px; border: 1px solid #dfe7e1; border-radius: 14px; background: #fff; box-shadow: 0 6px 22px rgb(23 63 51 / 6%); }
.primary-kpi p { margin: 0 0 10px; color: #607068; font-size: 14px; font-weight: 600; }
.primary-kpi strong { font-size: clamp(34px, 4vw, 48px); line-height: 1; color: #173f33; font-variant-numeric: tabular-nums; }
.status-dot, .mini-dot { display: inline-block; flex: 0 0 auto; border-radius: 50%; background: #8a9991; }
.status-dot { width: 9px; height: 9px; margin-top: 4px; }
.kpi-online { background: #f1f8f3; border-color: #d1e7d8; }.kpi-online .status-dot, .dot-online { background: #38935f; }
.kpi-offline { background: #f7f8f7; }.kpi-offline .status-dot, .dot-offline, .dot-unknown { background: #8a9991; }
.kpi-alarm { background: #fff4f1; border-color: #f0d6cf; }.kpi-alarm .status-dot, .dot-alarm { background: #d3593f; }
.dashboard-section { width: 100%; min-width: 0; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
.section-heading h2 { margin: 2px 0 0; color: #173f33; font-size: 23px; letter-spacing: -.025em; }
.section-heading > p { margin: 0; color: #718078; font-size: 13px; text-align: right; }
.section-kicker { margin: 0; color: #4c8b70; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.energy-grid { display: grid; width: 100%; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1px; margin: 0; overflow: hidden; border: 1px solid #dfe7e1; border-radius: 13px; background: #dfe7e1; }
.energy-metric { min-width: 0; min-height: 116px; padding: 22px; background: #fff; }
.energy-metric + .energy-metric { border-left: 0; }
.energy-metric dt { min-height: 34px; color: #617168; font-size: 13px; }
.energy-metric dd { margin: 9px 0 0; color: #174d3c; font-size: clamp(20px, 2.2vw, 28px); font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.energy-metric dd span { color: #718078; font-size: 12px; font-weight: 500; white-space: nowrap; }
.system-layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(220px, 1fr); gap: 16px; }
.system-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; padding: 26px; border: 1px solid #dfe7e1; border-radius: 13px; background: #fff; box-shadow: 0 4px 18px rgb(23 63 51 / 4%); }
.system-metrics > div { padding: 0 18px; }
.system-metrics > div + div { border-left: 1px solid #dfe7e1; }
.system-metrics dt, .provider-overview dt, .technical-inventory dt { display: flex; align-items: center; gap: 7px; color: #65756c; font-size: 12px; }
.system-metrics dd { margin: 9px 0 0; color: #173f33; font-size: 28px; font-weight: 700; }
.mini-dot { width: 6px; height: 6px; }
.system-note { display: flex; flex-direction: column; justify-content: center; padding: 22px 26px; border-radius: 12px; background: #174d3c; color: white; }
.system-note strong { font-size: 28px; }.system-note span { margin-top: 5px; color: #c9ded4; font-size: 13px; }
.providers-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.provider-panel { min-width: 0; padding: 28px; border: 1px solid #dfe7e1; border-radius: 14px; background: #fff; box-shadow: 0 5px 20px rgb(23 63 51 / 5%); }
.provider-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid #e5ebe7; }
.provider-header > div { display: flex; align-items: center; gap: 10px; }.provider-header h3 { margin: 0; color: #173f33; font-size: 21px; }
.provider-header > span { color: #718078; font-size: 12px; }.provider-mark { width: 9px; height: 24px; border-radius: 5px; background: #56a27f; }
.provider-overview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 26px; margin: 22px 0 0; }
.provider-overview dd, .technical-inventory dd { margin: 5px 0 0; color: #174d3c; font-size: 21px; font-weight: 700; }
.technical-inventory { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5ebe7; }
.technical-inventory h4 { margin: 0 0 12px; color: #40594e; font-size: 13px; }.technical-inventory dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; }
.technical-inventory dd { font-size: 17px; }
@media (max-width: 1050px) { .energy-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.system-layout { grid-template-columns: 1fr; } }
@media (max-width: 800px) { .dashboard-header { align-items: flex-start; flex-direction: column; }.header-action { width: 100%; justify-content: space-between; }.primary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.providers-grid { grid-template-columns: 1fr; }.system-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 0; }.system-metrics > div:nth-child(3) { border-left: 0; } }
@media (max-width: 520px) { .dashboard { gap: 34px; }.header-action { align-items: stretch; flex-direction: column; }.sync-button { width: 100%; }.primary-grid, .energy-grid, .system-metrics { grid-template-columns: 1fr; }.energy-metric { padding: 18px; }.system-metrics > div { padding: 17px 4px; }.system-metrics > div + div { border-left: 0; border-top: 1px solid #e5ebe7; }.section-heading { align-items: flex-start; flex-direction: column; gap: 7px; }.section-heading > p { text-align: left; }.provider-panel { padding: 20px; }.technical-inventory { grid-template-columns: 1fr; } }
</style>
