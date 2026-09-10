<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '../services/api.js';
const route = useRoute();
const detail = ref(null), loading = ref(true), error = ref('');
const statuses = { online: 'En línea', offline: 'Sin conexión', alarm: 'Alarma', inactive: 'Inactivo', unknown: 'Desconocido' };
const freshness = { fresh: 'Actualizado', stale: 'Stale · Desactualizado', no_data: 'Sin datos' };
const fields = [
  ['pv_power', 'Potencia fotovoltaica', 'W'], ['ac_power', 'Potencia AC', 'W'],
  ['load_power', 'Consumo', 'W'], ['grid_power', 'Potencia de red (unidad original)', ''],
  ['grid_import_power', 'Importación de red', 'W'], ['grid_export_power', 'Exportación de red', 'W'],
  ['battery_power', 'Potencia de batería', 'W'], ['battery_charge_power', 'Carga de batería', 'W'],
  ['battery_discharge_power', 'Descarga de batería', 'W'], ['battery_soc', 'Estado de carga', '%'],
  ['today_energy', 'Energía de hoy', 'kWh'], ['total_energy', 'Energía total', 'kWh'],
  ['pv1_voltage', 'Tensión PV1', 'V'], ['pv1_current', 'Corriente PV1', 'A'], ['pv1_power', 'Potencia PV1', 'W'],
  ['pv2_voltage', 'Tensión PV2', 'V'], ['pv2_current', 'Corriente PV2', 'A'], ['pv2_power', 'Potencia PV2', 'W'],
  ['frequency', 'Frecuencia', 'Hz'], ['inverter_temperature', 'Temperatura del inversor', '°C'], ['bus_voltage', 'Tensión del bus', 'V'],
];
const metrics = computed(() => fields.filter(([key]) => detail.value?.device_latest_data?.[key] != null));
const identity = [['serial_number', 'Número de serie'], ['provider', 'Proveedor'], ['model', 'Modelo'], ['device_type', 'Tipo'], ['software_version', 'Software']];
function date(value) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Sin datos'; }
function number(value) { return new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(value); }
watch(() => route.params.id, async (id, previous, cleanup) => {
  const controller = new AbortController();
  cleanup(() => controller.abort());
  loading.value = true; error.value = ''; detail.value = null;
  try {
    const data = await apiFetch(`/devices/${encodeURIComponent(id)}`, { signal: controller.signal });
    if (!data?.device) throw new Error('Respuesta inválida');
    if (!controller.signal.aborted) detail.value = data;
  } catch (failure) {
    if (!controller.signal.aborted) error.value = failure.status === 404 ? 'Dispositivo no encontrado.' : 'No se pudo cargar el dispositivo. Comprueba la conexión e inténtalo de nuevo.';
  } finally { if (!controller.signal.aborted) loading.value = false; }
}, { immediate: true });
</script>

<template>
  <RouterLink class="back-link" to="/devices">← Volver a dispositivos</RouterLink>
  <header class="page-header"><p class="eyebrow">Monitoreo multimarca</p><h1>{{ detail?.device.name || detail?.device.serial_number || 'Detalle de dispositivo' }}</h1></header>
  <p v-if="loading" class="card" role="status">Cargando dispositivo…</p>
  <p v-else-if="error" class="card" role="alert">{{ error }}</p>
  <div v-else-if="detail" class="sections">
    <section class="card"><h2>Identificación</h2><dl>
      <div v-for="[key, label] in identity" :key="key"><dt>{{ label }}</dt><dd>{{ detail.device[key] ?? 'Sin datos' }}</dd></div>
      <div><dt>Estado</dt><dd><span class="badge">{{ statuses[detail.device.status] ?? detail.device.status ?? 'Desconocido' }}</span></dd></div>
      <div><dt>Activo</dt><dd>{{ detail.device.active ? 'Sí' : 'No' }}</dd></div>
      <div><dt>Planta</dt><dd><RouterLink v-if="detail.plant" :to="`/plants/${detail.plant.id}`">{{ detail.plant.name }}</RouterLink><span v-else>Sin planta asociada</span></dd></div>
      <div><dt>Última sincronización</dt><dd>{{ date(detail.device.last_synced_at) }}</dd></div>
    </dl></section>
    <section><h2>Última telemetría</h2>
      <p><span class="badge" :class="detail.data_status">{{ freshness[detail.data_status] ?? 'Sin datos' }}</span> · {{ date(detail.device_latest_data?.collected_at) }}</p>
      <p v-if="detail.data_status === 'stale'" class="notice">Los valores corresponden a la última lectura conocida y pueden diferir de los actuales.</p>
      <p v-if="detail.data_age_minutes != null">{{ detail.data_age_minutes < 60 ? `Hace ${number(detail.data_age_minutes)} min` : `Hace ${number(detail.data_age_minutes / 60)} h` }}</p>
      <p v-if="detail.device_latest_data?.device_status">Estado de telemetría: {{ statuses[detail.device_latest_data.device_status] ?? detail.device_latest_data.device_status }}</p>
      <p v-if="!metrics.length" class="card">Sin datos de métricas.</p>
      <div v-else class="metrics"><article v-for="[key, label, unit] in metrics" :key="key" class="card"><h3>{{ label }}</h3><p class="value">{{ number(detail.device_latest_data[key]) }} <small>{{ unit }}</small></p></article></div>
    </section>
  </div>
</template>

<style scoped>
.sections { display: grid; gap: 32px; }
h1, dd { overflow-wrap: anywhere; }
h2 { margin: 0 0 20px; }
dl, .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 20px; }
dl { margin: 0; }
dt, h3 { font-size: 14px; color: #5b6d63; font-weight: 500; }
dd { margin: 6px 0 0; }
.metrics .card { padding: 24px; }
h3 { margin: 0 0 12px; }
.value { color: #174d3c; font-size: 24px; font-weight: 700; margin: 0; }
small { font-size: 14px; }
.stale, .notice { background: #fff0d8; color: #80520d; }
.notice { padding: 16px; border-radius: 8px; }
.no_data { background: #edf0ef; color: #53615a; }
</style>
