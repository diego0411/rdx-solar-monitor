<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '../services/api.js';
import PlantPowerCurve from '../components/PlantPowerCurve.vue';
import PlantEnergyHistory from '../components/PlantEnergyHistory.vue';

const route = useRoute();
const detail = ref(null), loading = ref(true), error = ref(''), notFound = ref(false);
const statuses = { online: 'En línea', offline: 'Sin conexión', alarm: 'Alarma', inactive: 'Inactiva', unknown: 'Desconocido' };
const freshness = { fresh: 'Actualizado', stale: 'Desactualizado', no_data: 'Sin datos' };
const energyFields = [
  ['today_generation_kwh', 'Generación de hoy'], ['month_generation_kwh', 'Generación del mes'],
  ['year_generation_kwh', 'Generación del año'], ['total_generation_kwh', 'Generación total'],
  ['today_consumption_kwh', 'Consumo de hoy'], ['month_consumption_kwh', 'Consumo del mes'],
  ['year_consumption_kwh', 'Consumo del año'], ['total_consumption_kwh', 'Consumo total'],
];
const realtimeFields = [
  ['pv_power', 'Potencia fotovoltaica', 'W'], ['ac_power', 'Potencia AC', 'W'],
  ['load_power', 'Consumo', 'W'], ['grid_import_power', 'Importación de red', 'W'],
  ['grid_export_power', 'Exportación de red', 'W'], ['battery_charge_power', 'Carga de batería', 'W'],
  ['battery_discharge_power', 'Descarga de batería', 'W'],
  ['current_grid_power', 'Potencia de red', ''], ['battery_power_w', 'Potencia de batería', 'W'],
  ['battery_soc', 'Carga de batería', '%'],
];
const visibleRealtime = computed(() => realtimeFields.filter(([key]) => detail.value?.realtime?.[key] != null));
const visibleEnergy = computed(() => energyFields.filter(([key]) => detail.value?.energy?.[key] != null));
function number(value, unit = '', digits = 2) {
  if (unit === 'W' && typeof value === 'number' && Math.abs(value) >= 1000) {
    value /= 1000;
    unit = 'kW';
  }
  return typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('es-BO', { maximumFractionDigits: digits }).format(value)}${unit ? ` ${unit}` : ''}` : 'Sin datos';
}
function date(value) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Sin datos';
}
function age(value) {
  if (value == null || !Number.isFinite(value)) return 'Sin datos';
  return value < 60 ? `Hace ${number(value)} min` : `Hace ${number(value / 60, '', 1)} h`;
}
watch(() => route.params.id, async (id, previous, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  loading.value = true;
  error.value = '';
  notFound.value = false;
  detail.value = null;
  try {
    const data = await apiFetch(`/plants/${encodeURIComponent(id)}/overview`, { signal: controller.signal });
    if (!data?.plant || !data.energy || !data.realtime || !Array.isArray(data.devices)) throw new Error('Respuesta inválida');
    if (!controller.signal.aborted) detail.value = data;
  } catch (failure) {
    if (!controller.signal.aborted) {
      notFound.value = failure.status === 404;
      error.value = 'No se pudo cargar la planta. Comprueba la conexión con el servidor y vuelve a cargar la página.';
    }
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}, { immediate: true });
</script>

<template>
  <RouterLink class="back-link" to="/plants">← Volver a plantas</RouterLink>
  <header class="page-header">
    <p class="eyebrow">Monitoreo</p>
    <h1>{{ detail?.plant.name ?? 'Detalle de planta' }}</h1>
    <p>Información de la instalación solar.</p>
  </header>
  <div v-if="loading" class="card" role="status">Cargando detalle de planta…</div>
  <div v-else-if="notFound" class="card" role="alert"><h2>Planta no encontrada</h2><p>No existe una planta con este identificador. Vuelve al listado para seleccionar otra.</p></div>
  <div v-else-if="error" class="card" role="alert">{{ error }}</div>
  <div v-else-if="detail" class="sections">
    <section class="card" aria-labelledby="general-title">
      <h2 id="general-title">Información general</h2>
      <dl class="general-grid">
        <div><dt>Nombre</dt><dd>{{ detail.plant.name }}</dd></div>
        <div><dt>Proveedor</dt><dd>{{ detail.plant.provider ?? 'Sin datos' }}</dd></div>
        <div><dt>Estado HYXi</dt><dd><span class="badge" :class="`state-${detail.plant.status}`">{{ statuses[detail.plant.status] ?? statuses.unknown }}</span></dd></div>
        <div><dt>Capacidad</dt><dd>{{ number(detail.plant.capacity_kwp, 'kWp') }}</dd></div>
        <div><dt>Tipo de planta</dt><dd>{{ detail.plant.plant_type ?? 'Sin datos' }}</dd></div>
        <div><dt>Zona horaria</dt><dd>{{ detail.plant.timezone ?? 'Sin datos' }}</dd></div>
        <div class="address"><dt>Dirección</dt><dd>{{ detail.plant.address ?? 'Sin datos' }}</dd></div>
        <div><dt>Latitud</dt><dd>{{ number(detail.plant.latitude, '', 5) }}</dd></div>
        <div><dt>Longitud</dt><dd>{{ number(detail.plant.longitude, '', 5) }}</dd></div>
        <div><dt>Última lectura</dt><dd>{{ date(detail.plant.last_data_at) }}</dd></div>
      </dl>
    </section>
    <section aria-labelledby="energy-title">
      <h2 id="energy-title">Energía</h2>
      <p v-if="!visibleEnergy.length">Sin datos de energía.</p>
      <div class="metrics"><article v-for="[key, label] in visibleEnergy" :key="key" class="card metric"><h3>{{ label }}</h3><p>{{ number(detail.energy[key], 'kWh') }}</p></article></div>
    </section>
    <section aria-labelledby="realtime-title">
      <h2 id="realtime-title">Flujo energético</h2>
      <p class="telemetry"><span class="badge" :class="`data-${detail.realtime.data_status}`">{{ freshness[detail.realtime.data_status] ?? freshness.no_data }}</span> <span>{{ age(detail.realtime.data_age_minutes) }}</span></p>
      <p v-if="detail.realtime.data_status === 'stale'" class="stale-notice" role="note"><strong>Telemetría desactualizada.</strong> Los valores corresponden a la última lectura conocida y pueden diferir de la potencia actual.</p>
      <p v-if="!visibleRealtime.length">Sin datos de telemetría.</p>
      <div class="metrics"><article v-for="[key, label, unit] in visibleRealtime" :key="key" class="card metric"><h3>{{ label }}</h3><p>{{ number(detail.realtime[key], unit) }}</p><small v-if="key === 'current_grid_power'">Unidad original del API</small></article></div>
    </section>
    <PlantPowerCurve :plant-id="String(route.params.id)" :timezone="detail.plant.timezone" />
    <PlantEnergyHistory :plant-id="String(route.params.id)" :timezone="detail.plant.timezone" />
    <section aria-labelledby="devices-title">
      <h2 id="devices-title">Dispositivos ({{ detail.devices.length }})</h2>
      <p v-if="!detail.devices.length" class="card">No hay dispositivos registrados para esta planta.</p>
      <ul v-else class="device-list">
        <li v-for="device in detail.devices" :key="device.id" class="card">
          <h3><RouterLink :to="`/devices/${device.id}`">{{ device.name ?? 'Dispositivo sin nombre' }} →</RouterLink></h3>
          <dl class="general-grid">
            <div><dt>Número de serie</dt><dd>{{ device.serial_number ?? 'Sin datos' }}</dd></div>
            <div><dt>Modelo</dt><dd>{{ device.model ?? 'Sin datos' }}</dd></div>
            <div><dt>Tipo</dt><dd>{{ device.device_type ?? 'Sin datos' }}</dd></div>
            <div><dt>Estado</dt><dd><span class="badge" :class="`state-${device.status}`">{{ statuses[device.status] ?? statuses.unknown }}</span></dd></div>
            <div><dt>Potencia nominal</dt><dd>{{ number(device.rated_power_w, 'W') }}</dd></div>
            <div><dt>Versión de software</dt><dd>{{ device.software_version ?? 'Sin datos' }}</dd></div>
            <div><dt>Última lectura</dt><dd>{{ date(device.last_data_at) }}</dd></div>
          </dl>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.sections { display: grid; gap: 40px; min-width: 0; }
.sections > section { min-width: 0; }
h1 { overflow-wrap: anywhere; }
h2 { margin: 0 0 20px; font-size: 21px; letter-spacing: -.02em; }
.sections > section:not(.card) { padding-top: 24px; border-top: 1px solid #dfe7e1; }
.general-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 20px; margin: 0; }
dt, .metric h3, small { font-size: 13px; color: #5b6d63; font-weight: 500; }
dd { margin: 6px 0 0; overflow-wrap: anywhere; font-weight: 500; font-variant-numeric: tabular-nums; }
.address { grid-column: 1 / -1; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 16px; }
.metric { padding: 24px; }
.metric h3 { margin: 0 0 12px; line-height: 1.5; }
.metric p { font-size: clamp(22px, 2.5vw, 28px); font-weight: 700; color: #174d3c; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.device-list { list-style: none; padding: 0; display: grid; gap: 16px; }
.device-list h3 { margin: 0 0 20px; padding-bottom: 16px; border-bottom: 1px solid #e7ede9; font-size: 17px; overflow-wrap: anywhere; }
.device-list .card { padding: 24px; }
.badge { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 20px; font-weight: 600; line-height: 1.5; }
.badge::before { content: ''; width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: currentColor; }
.stale-notice { padding: 14px 18px; border: 1px solid #ebd7b5; border-left: 3px solid #ae751a; border-radius: 8px; background: #fff8eb; color: #765018; font-size: 14px; }
.telemetry { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.state-online, .data-fresh { background: #e5f2e9; color: #245537; }
.state-offline, .state-inactive, .state-unknown, .data-no_data { background: #edf0ef; color: #53615a; }
.state-alarm { background: #fbe8e4; color: #963d2a; }
.data-stale { background: #fff0d8; color: #80520d; }
@media (max-width: 600px) {
  .sections { gap: 28px; }
  .metrics { gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric { padding: 16px; }
  .metric p { font-size: 21px; }
  .general-grid { gap: 18px; }
}
@media (max-width: 380px) { .metrics { grid-template-columns: 1fr; } }
</style>
