<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { apiFetch } from '../services/api.js';
import { deviceDisplayName } from '../utils/deviceDisplay.js';
const devices = ref([]), loading = ref(true), error = ref('');
const provider = ref(''), status = ref('');
const controller = new AbortController();
const names = { hyxi: 'HYXi', growatt: 'Growatt' };
const states = { online: 'En línea', offline: 'Sin conexión', alarm: 'Alarma', inactive: 'Inactivo', unknown: 'Desconocido' };
const providers = computed(() => [...new Set(devices.value.map(row => row.provider).filter(Boolean))].sort());
const statuses = computed(() => [...new Set([...Object.keys(states), ...devices.value.map(row => row.status).filter(Boolean)])]);
const filtered = computed(() => devices.value.filter(row => (!provider.value || row.provider === provider.value)
  && (!status.value || row.status === status.value)));
function date(value) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Sin datos';
}
onMounted(async () => {
  try {
    const data = await apiFetch('/devices', { signal: controller.signal });
    if (!Array.isArray(data)) throw new Error('Respuesta inválida');
    devices.value = data;
  } catch {
    if (!controller.signal.aborted) error.value = 'No se pudieron cargar los dispositivos. Comprueba la conexión y vuelve a cargar la página.';
  } finally { loading.value = false; }
});
onUnmounted(() => controller.abort());
</script>

<template>
  <header class="page-header"><p class="eyebrow">Monitoreo multimarca</p><h1>Dispositivos</h1><p>Consulta los dispositivos de todos tus proveedores.</p></header>
  <p v-if="loading" class="card" role="status">Cargando dispositivos…</p>
  <p v-else-if="error" class="card" role="alert">{{ error }}</p>
  <template v-else>
    <form class="card filters" @submit.prevent>
      <label>Proveedor<select v-model="provider"><option value="">Todos</option><option v-for="item in providers" :key="item" :value="item">{{ names[item] ?? item }}</option></select></label>
      <label>Estado<select v-model="status"><option value="">Todos</option><option v-for="item in statuses" :key="item" :value="item">{{ states[item] ?? item }}</option></select></label>
    </form>
    <p role="status">{{ filtered.length }} de {{ devices.length }} dispositivos</p>
    <p v-if="!filtered.length" class="card">No hay dispositivos que coincidan con los filtros.</p>
    <ul v-else class="device-list">
      <li v-for="device in filtered" :key="device.id" class="card">
        <div class="device-heading"><h2>{{ deviceDisplayName(device) }}</h2><span class="badge">{{ names[device.provider] ?? device.provider }}</span><span class="badge" :class="`state-${device.status}`">{{ states[device.status] ?? device.status ?? states.unknown }}</span></div>
        <dl>
          <div><dt>Detalle</dt><dd><RouterLink :to="`/devices/${device.id}`">Ver dispositivo →</RouterLink></dd></div>
          <div><dt>Número de serie</dt><dd>{{ device.serial_number ?? 'Sin datos' }}</dd></div>
          <div><dt>Modelo</dt><dd>{{ device.model ?? 'Sin datos' }}</dd></div>
          <div><dt>Tipo</dt><dd>{{ device.device_type ?? 'Sin datos' }}</dd></div>
          <div><dt>Activo</dt><dd>{{ device.active === null ? 'Sin datos' : device.active ? 'Sí' : 'No' }}</dd></div>
          <div><dt>Planta</dt><dd><RouterLink v-if="device.plant_id" :to="`/plants/${device.plant_id}`">Ver planta →</RouterLink><span v-else>Sin planta asociada</span></dd></div>
          <div><dt>Última lectura</dt><dd>{{ date(device.last_data_at) }}</dd></div>
          <div><dt>Última sincronización</dt><dd>{{ date(device.last_synced_at) }}</dd></div>
        </dl>
      </li>
    </ul>
  </template>
</template>

<style scoped>
.filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; padding: 24px; }
label { display: grid; gap: 8px; font-size: 14px; font-weight: 600; }
select { width: 100%; min-width: 0; padding: 10px; border: 1px solid #cad8ce; border-radius: 8px; background: white; color: #243b32; font: inherit; }
select:focus-visible { outline: 3px solid #529b79; outline-offset: 2px; }
.device-list { list-style: none; padding: 0; display: grid; gap: 16px; }
.device-list .card { padding: 24px; }
.device-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
h2 { margin: 0; font-size: 19px; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 20px; margin: 24px 0 0; }
dt { font-size: 13px; color: #5b6d63; }
dd { margin: 5px 0 0; overflow-wrap: anywhere; }
.state-offline, .state-unknown, .state-inactive { background: #edf0ef; color: #53615a; }
.state-alarm { background: #fbe8e4; color: #963d2a; }
@media (max-width: 600px) { .filters { grid-template-columns: 1fr; } }
</style>
