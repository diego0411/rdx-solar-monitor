<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { apiFetch } from '../services/api.js';
const plants = ref([]), loading = ref(true), error = ref('');
const search = ref(''), provider = ref(''), status = ref(''), dataStatus = ref('');
const controller = new AbortController();
const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };
const statuses = { online: 'En línea', offline: 'Sin conexión', alarm: 'Alarma', inactive: 'Inactiva', unknown: 'Desconocido' };
const freshness = { fresh: 'Reciente', stale: 'Antigua', no_data: 'Sin datos' };
const number = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' });
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const filteredPlants = computed(() => plants.value.filter(plant =>
  normalize(plant.name).includes(normalize(search.value.trim()))
  && (!provider.value || plant.provider === provider.value)
  && (!status.value || plant.status === status.value)
  && (!dataStatus.value || plant.data_status === dataStatus.value)));
function formatValue(value, unit) {
  return typeof value === 'number' && Number.isFinite(value) ? `${number.format(value)} ${unit}` : 'Sin datos';
}
function age(value) {
  if (value == null || !Number.isFinite(value)) return 'Sin datos';
  return value < 60 ? `Hace ${number.format(value)} min` : `Hace ${number.format(Number((value / 60).toFixed(1)))} h`;
}
function lastData(value) {
  return value && Number.isFinite(Date.parse(value)) ? date.format(new Date(value)) : 'Sin datos';
}
onMounted(async () => {
  try {
    const data = await apiFetch('/plants/overview', { signal: controller.signal });
    if (!Array.isArray(data)) throw new Error('Respuesta inválida');
    plants.value = data;
  } catch {
    if (!controller.signal.aborted) error.value = 'No se pudieron cargar las plantas. Comprueba la conexión con el servidor y vuelve a cargar la página.';
  } finally { loading.value = false; }
});
onUnmounted(() => controller.abort());
</script>

<template>
  <header class="page-header">
    <p class="eyebrow">Monitoreo</p>
    <h1>Plantas</h1>
    <p>Consulta tus instalaciones solares en un solo lugar.</p>
  </header>
  <div v-if="loading" class="card" role="status">Cargando plantas…</div>
  <div v-else-if="error" class="card" role="alert">{{ error }}</div>
  <template v-else>
    <form class="filters card" aria-label="Filtros de plantas" @submit.prevent>
      <label>Nombre<input v-model="search" type="search" placeholder="Buscar planta" /></label>
      <label>Marca<select v-model="provider"><option value="">Todas</option><option value="hyxi">HYXi</option><option value="growatt">Growatt</option></select></label>
      <label>Estado<select v-model="status"><option value="">Todos</option><option v-for="(label, key) in statuses" :key="key" :value="key">{{ label }}</option></select></label>
      <label>Telemetría<select v-model="dataStatus"><option value="">Todas</option><option v-for="(label, key) in freshness" :key="key" :value="key">{{ label }}</option></select></label>
    </form>
    <p role="status">{{ filteredPlants.length }} de {{ plants.length }} plantas</p>
    <p v-if="!filteredPlants.length" class="card">{{ plants.length ? 'No hay plantas que coincidan con los filtros.' : 'No hay plantas disponibles.' }}</p>
    <ul v-else class="plant-list">
      <li v-for="plant in filteredPlants" :key="plant.id">
        <RouterLink :to="`/plants/${plant.id}`" class="card plant-row" :aria-label="`Ver detalle de ${plant.name}`">
          <div class="plant-heading"><h2>{{ plant.name }}</h2><span class="provider">{{ providerNames[plant.provider] ?? plant.provider }}</span><span class="open-label">Ver detalle →</span></div>
          <div class="state-badges">
            <span>Estado <span class="badge" :class="`state-${plant.status}`">{{ statuses[plant.status] ?? statuses.unknown }}</span></span>
            <span>Telemetría <span class="badge" :class="`data-${plant.data_status}`">{{ freshness[plant.data_status] ?? freshness.no_data }}</span></span>
          </div>
          <dl class="plant-metrics">
            <div><dt>Capacidad</dt><dd>{{ formatValue(plant.capacity_kwp, 'kWp') }}</dd></div>
            <div><dt>{{ plant.data_status === 'fresh' ? 'Potencia actual' : 'Última potencia conocida' }}</dt><dd>{{ formatValue(plant.current_power_w, 'W') }}</dd><small v-if="plant.data_status === 'stale'">Último dato {{ age(plant.data_age_minutes).toLowerCase() }}</small></div>
            <div><dt>Generación de hoy</dt><dd>{{ formatValue(plant.today_generation_kwh, 'kWh') }}</dd></div>
            <div><dt>Consumo de hoy</dt><dd>{{ formatValue(plant.today_consumption_kwh, 'kWh') }}</dd></div>
            <div><dt>Última lectura</dt><dd class="date-value">{{ lastData(plant.last_data_at) }}</dd><small>{{ age(plant.data_age_minutes) }}</small></div>
          </dl>
          <div v-if="plant.inverter_total != null" class="technical-status">
            <div v-if="plant.inverter_total != null">
              <h3>Inversores</h3>
              <dl class="technical-metrics">
                <div><dt>Total</dt><dd>{{ plant.inverter_total }}</dd></div>
                <div><dt>En línea</dt><dd>{{ plant.inverter_online }}</dd></div>
                <div><dt>Sin conexión</dt><dd>{{ plant.inverter_offline }}</dd></div>
                <div><dt>Con alarma</dt><dd>{{ plant.inverter_alarm }}</dd></div>
              </dl>
            </div>
            <div v-if="plant.communication_total != null">
              <h3>Comunicación</h3>
              <dl class="technical-metrics">
                <div><dt>Total</dt><dd>{{ plant.communication_total }}</dd></div>
                <div><dt>En línea</dt><dd>{{ plant.communication_online }}</dd></div>
                <div><dt>Sin conexión</dt><dd>{{ plant.communication_offline }}</dd></div>
                <div><dt>Con alarma</dt><dd>{{ plant.communication_alarm }}</dd></div>
              </dl>
            </div>
            <dl v-if="plant.provider === 'hyxi'" class="technical-dates">
              <div><dt>Última telemetría técnica</dt><dd>{{ lastData(plant.latest_collected_at) }}</dd></div>
              <div><dt>Última sincronización técnica</dt><dd>{{ lastData(plant.latest_synced_at) }}</dd></div>
            </dl>
          </div>
        </RouterLink>
      </li>
    </ul>
  </template>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: 2fr repeat(3, 1fr); gap: 18px; padding: 24px; }
.filters label { display: grid; gap: 6px; font-size: 14px; font-weight: 600; }
input, select { width: 100%; min-width: 0; padding: 10px 12px; border: 1px solid #cad8ce; border-radius: 7px; background: white; color: #243b32; font: inherit; }
input:focus-visible, select:focus-visible { outline: 2px solid #529b79; outline-offset: 2px; }
.plant-list { list-style: none; padding: 0; display: grid; gap: 16px; }
.plant-row { display: block; padding: 24px; }
.plant-row:hover { border-color: #529b79; }
.plant-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; }
.plant-heading h2 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
.provider { text-transform: uppercase; font-size: 12px; color: #5b6d63; }
.open-label { margin-left: auto; font-size: 13px; }
.state-badges { display: flex; flex-wrap: wrap; gap: 12px 24px; margin-top: 16px; font-size: 12px; color: #5b6d63; }
.badge { margin-left: 5px; }
.state-online, .data-fresh { background: #e5f2e9; color: #245537; }
.state-offline, .state-inactive, .state-unknown, .data-no_data { background: #edf0ef; color: #53615a; }
.state-alarm { background: #fbe8e4; color: #963d2a; }
.data-stale { background: #fff0d8; color: #80520d; }
.plant-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 20px; margin: 24px 0 0; }
dt, small { color: #5b6d63; font-size: 12px; }
dd { margin: 6px 0 0; font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
.date-value { font-size: 14px; }
.technical-status { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #dce6df; }
.technical-status h3 { margin: 0 0 10px; font-size: 14px; color: #174d3c; }
.technical-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0; }
.technical-metrics dd { font-size: 16px; }
.technical-dates { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin: 0; }
.technical-dates dd { font-size: 14px; }
@media (max-width: 1100px) { .plant-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .filters { grid-template-columns: 1fr; } .open-label { margin-left: 0; } .technical-status { grid-template-columns: 1fr; } .technical-dates { grid-column: auto; grid-template-columns: 1fr; } }
@media (max-width: 380px) { .plant-metrics { grid-template-columns: 1fr; } }
</style>
