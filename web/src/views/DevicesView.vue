<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { apiFetch } from '../services/api.js';

const PAGE_SIZE = 8;
const devices = ref([]);
const loading = ref(true);
const refreshing = ref(false);
const error = ref('');
const selected = ref(null);
const search = ref('');
const plant = ref('');
const provider = ref('');
const deviceType = ref('');
const status = ref('');
const page = ref(1);
let controller;

const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };
const statuses = { online: 'En línea', offline: 'Sin conexión', alarm: 'Con alarma', inactive: 'Inactivo', unknown: 'Desconocido' };
const typeLabels = { STRING_INVERTER: 'Inversor string', HYBRID_INVERTER: 'Inversor híbrido', COLLECTOR: 'Comunicador', MIN: 'Inversor' };
const number = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 });
const dateTime = new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const hasValue = value => value !== null && value !== undefined;
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const typeLabel = value => typeLabels[String(value ?? '').toUpperCase()] ?? value ?? '—';
const isCollector = device => String(device?.device_type ?? '').toUpperCase() === 'COLLECTOR';

function deviceTitle(device) {
  const name = String(device?.name ?? '').trim();
  const model = String(device?.model ?? '').trim();
  const serial = String(device?.serial_number ?? '').trim();
  if (name && name !== serial) return name;
  if (model && model !== serial) return model;
  return typeLabel(device?.device_type) || 'Dispositivo';
}

function currentPower(device) {
  if (isCollector(device)) return null;
  if (hasValue(device?.ac_power)) return device.ac_power;
  return hasValue(device?.pv_power) ? device.pv_power : null;
}

function power(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return '—';
  const watts = Number(value);
  return Math.abs(watts) < 1000 ? `${number.format(watts)} W` : `${number.format(watts / 1000)} kW`;
}

function fullDate(value) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(timestamp) ? dateTime.format(new Date(timestamp)) : '—';
}

function relative(value) {
  if (value == null || !Number.isFinite(Date.parse(value))) return 'Sin datos';
  const minutes = Math.max(0, (Date.now() - Date.parse(value)) / 60000);
  if (minutes < 60) return `Hace ${number.format(Math.round(minutes))} min`;
  if (minutes < 1440) return `Hace ${number.format(Number((minutes / 60).toFixed(1)))} h`;
  return `Hace ${number.format(Math.floor(minutes / 1440))} d`;
}

const summary = computed(() => ({
  total: devices.value.length,
  online: devices.value.filter(item => item.status === 'online').length,
  offline: devices.value.filter(item => item.status === 'offline').length,
  alarm: devices.value.filter(item => item.status === 'alarm').length,
}));

const plants = computed(() => {
  const values = new Map();
  devices.value.forEach(item => { if (item.plant_id) values.set(item.plant_id, item.plant_name ?? 'Sin nombre'); });
  return [...values].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
});
const providers = computed(() => [...new Set(devices.value.map(item => item.provider).filter(Boolean))].sort());
const deviceTypes = computed(() => [...new Set(devices.value.map(item => item.device_type).filter(Boolean))].sort());
const availableStatuses = computed(() => [...new Set(devices.value.map(item => item.status ?? 'unknown'))].sort());
const lastUpdated = computed(() => {
  const times = devices.value.map(item => Date.parse(item.collected_at ?? '')).filter(Number.isFinite);
  return times.length ? fullDate(Math.max(...times)) : 'Sin lecturas';
});

const filtered = computed(() => {
  const term = normalize(search.value.trim());
  return devices.value.filter(item => normalize(`${item.name ?? ''} ${item.serial_number ?? ''} ${item.model ?? ''}`).includes(term)
    && (!plant.value || item.plant_id === plant.value)
    && (!provider.value || item.provider === provider.value)
    && (!deviceType.value || item.device_type === deviceType.value)
    && (!status.value || (item.status ?? 'unknown') === status.value));
});
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const pageDevices = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const pageRange = computed(() => filtered.value.length ? `${(page.value - 1) * PAGE_SIZE + 1}–${Math.min(page.value * PAGE_SIZE, filtered.value.length)} de ${filtered.value.length}` : '0 de 0');

function goToPage(value) { page.value = Math.min(totalPages.value, Math.max(1, value)); }

async function loadDevices() {
  controller?.abort();
  controller = new AbortController();
  devices.value.length ? refreshing.value = true : loading.value = true;
  error.value = '';
  try {
    const data = await apiFetch('/devices', { signal: controller.signal });
    if (!Array.isArray(data)) throw new Error('Respuesta inválida');
    devices.value = data;
    if (selected.value) selected.value = data.find(item => item.id === selected.value.id) ?? null;
  } catch {
    if (!controller.signal.aborted) error.value = 'No se pudieron cargar los dispositivos. Comprueba la conexión y vuelve a intentarlo.';
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

watch([search, plant, provider, deviceType, status], () => { page.value = 1; });
watch(totalPages, value => { if (page.value > value) page.value = value; });
onMounted(loadDevices);
onUnmounted(() => controller?.abort());
</script>

<template>
  <section class="devices-page">
    <header class="devices-header">
      <div><h1>Dispositivos</h1><p>Supervisa el estado y la telemetría de los equipos del parque.</p></div>
      <div class="header-actions">
        <p><span>Última actualización</span><strong>{{ lastUpdated }}</strong></p>
        <button type="button" :disabled="refreshing" @click="loadDevices">↻ {{ refreshing ? 'Actualizando…' : 'Actualizar' }}</button>
      </div>
    </header>

    <div v-if="loading" class="card feedback" role="status">Cargando dispositivos…</div>
    <div v-else-if="error && !devices.length" class="card feedback error" role="alert">{{ error }}</div>
    <template v-else>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <section class="summary-grid" aria-label="Resumen de dispositivos">
        <article><i class="icon">▤</i><div><p>Total dispositivos</p><strong>{{ summary.total }}</strong><small>Equipos registrados</small></div></article>
        <article><i class="icon online">✓</i><div><p>En línea</p><strong>{{ summary.online }}</strong><small>Operando normalmente</small></div></article>
        <article><i class="icon offline">!</i><div><p>Sin conexión</p><strong>{{ summary.offline }}</strong><small>Estado reportado offline</small></div></article>
        <article><i class="icon alarm">△</i><div><p>Con alarmas</p><strong>{{ summary.alarm }}</strong><small>Requieren atención</small></div></article>
      </section>

      <form class="filters" aria-label="Filtros de dispositivos" @submit.prevent>
        <label class="search"><span class="sr-only">Buscar</span><input v-model="search" type="search" placeholder="Buscar por nombre, SN o modelo" /></label>
        <label><span>Planta</span><select v-model="plant"><option value="">Todas las plantas</option><option v-for="item in plants" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <label><span>Proveedor</span><select v-model="provider"><option value="">Todos</option><option v-for="item in providers" :key="item" :value="item">{{ providerNames[item] ?? item }}</option></select></label>
        <label><span>Tipo</span><select v-model="deviceType"><option value="">Todos</option><option v-for="item in deviceTypes" :key="item" :value="item">{{ typeLabel(item) }}</option></select></label>
        <label><span>Estado</span><select v-model="status"><option value="">Todos</option><option v-for="item in availableStatuses" :key="item" :value="item">{{ statuses[item] ?? statuses.unknown }}</option></select></label>
      </form>

      <div class="content" :class="{ detailed: selected }">
        <section class="table-card">
          <header><div><h2>Todos los dispositivos</h2><p>{{ filtered.length }} de {{ devices.length }} dispositivos</p></div></header>
          <p v-if="!filtered.length" class="empty">{{ devices.length ? 'No hay dispositivos que coincidan con los filtros.' : 'No hay dispositivos disponibles.' }}</p>
          <div v-else class="table-scroll">
            <table>
              <thead><tr><th>Dispositivo</th><th>Planta</th><th>Proveedor</th><th>Tipo</th><th>Estado</th><th>Potencia actual</th><th>Última lectura</th><th><span class="sr-only">Acción</span></th></tr></thead>
              <tbody><tr v-for="item in pageDevices" :key="item.id" :class="{ selected: selected?.id === item.id }" tabindex="0" @click="selected = item" @keydown.enter="selected = item">
                <td><div class="device"><i>▤</i><span><strong>{{ deviceTitle(item) }}</strong><small>SN: {{ item.serial_number ?? '—' }}</small></span></div></td>
                <td>{{ item.plant_name ?? '—' }}</td><td><b class="provider">{{ providerNames[item.provider] ?? item.provider ?? '—' }}</b></td><td>{{ typeLabel(item.device_type) }}</td>
                <td><span class="status" :class="`state-${item.status ?? 'unknown'}`"><i />{{ statuses[item.status] ?? statuses.unknown }}</span></td>
                <td class="power">{{ power(currentPower(item)) }}</td><td><strong>{{ relative(item.collected_at) }}</strong><small class="date">{{ fullDate(item.collected_at) }}</small></td>
                <td><button class="row-action" type="button" @click.stop="selected = item">›</button></td>
              </tr></tbody>
            </table>
          </div>
          <nav v-if="filtered.length" class="pagination" aria-label="Paginación"><span>{{ pageRange }}</span><div><button :disabled="page <= 1" @click="goToPage(page - 1)">‹</button><b>{{ page }}</b><button :disabled="page >= totalPages" @click="goToPage(page + 1)">›</button></div></nav>
        </section>

        <aside v-if="selected" class="detail">
          <header><div><span>Detalle del dispositivo</span><h2>{{ deviceTitle(selected) }}</h2></div><button aria-label="Cerrar detalle" @click="selected = null">×</button></header>
          <div class="detail-hero"><i class="device-picture">▤</i><span class="status" :class="`state-${selected.status ?? 'unknown'}`"><i />{{ statuses[selected.status] ?? statuses.unknown }}</span></div>
          <dl><div><dt>Número de serie</dt><dd>{{ selected.serial_number ?? '—' }}</dd></div><div><dt>Planta</dt><dd>{{ selected.plant_name ?? '—' }}</dd></div><div><dt>Proveedor</dt><dd>{{ providerNames[selected.provider] ?? selected.provider ?? '—' }}</dd></div><div><dt>Modelo</dt><dd>{{ selected.model ?? '—' }}</dd></div><div><dt>Tipo</dt><dd>{{ typeLabel(selected.device_type) }}</dd></div></dl>
          <section class="telemetry"><h3>Telemetría</h3><p><span>Potencia actual</span><strong>{{ power(currentPower(selected)) }}</strong></p><p><span>Última lectura</span><strong>{{ fullDate(selected.collected_at) }}</strong></p></section>
          <RouterLink v-if="selected.plant_id" :to="`/plants/${selected.plant_id}`">Ver planta <span>→</span></RouterLink>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.devices-header,.header-actions,.summary-grid article,.content,.device,.status,.pagination,.pagination div,.detail header,.detail-hero{display:flex}.devices-header{justify-content:space-between;gap:24px;margin-bottom:24px}.devices-header h1{margin:0;font-size:34px;letter-spacing:-.04em}.devices-header p{margin:7px 0 0;color:var(--rdx-text-muted);font-size:14px}.header-actions{align-items:center;gap:18px}.header-actions p{display:grid;text-align:right}.header-actions span{font-size:10px}.header-actions strong{font-size:12px}.header-actions button{height:40px;padding:0 16px;border:1px solid var(--rdx-border);border-radius:8px;background:#fff;color:var(--rdx-accent);font-weight:700;cursor:pointer}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.summary-grid article,.filters,.table-card,.detail{border:1px solid var(--rdx-border);border-radius:11px;background:#fff;box-shadow:0 7px 24px rgba(26,55,47,.055)}.summary-grid article{align-items:center;gap:14px;min-height:105px;padding:18px}.summary-grid p{margin:0;color:var(--rdx-text-muted);font-size:12px}.summary-grid strong{display:block;font-size:27px}.summary-grid small{color:var(--rdx-text-faint);font-size:10px}.icon,.device-picture{display:grid;place-items:center;width:43px;height:43px;border-radius:50%;background:#edf6f2;color:var(--rdx-accent);font-style:normal}.icon.offline{background:#fff0ee;color:#c65348}.icon.alarm{background:#fff6e4;color:#d98a0a}.filters{display:grid;grid-template-columns:minmax(230px,2fr) repeat(4,minmax(120px,1fr));gap:12px;align-items:end;padding:16px;margin-bottom:18px}.filters label{display:grid;gap:6px;color:var(--rdx-text-muted);font-size:10px;font-weight:700}.filters input,.filters select{width:100%;height:39px;min-width:0;padding:0 11px;border:1px solid var(--rdx-border);border-radius:7px;background:#fff;color:var(--rdx-text-strong)}.filters input:focus,.filters select:focus{outline:2px solid rgba(22,120,87,.15);border-color:var(--rdx-accent)}.content{display:grid;grid-template-columns:minmax(0,1fr);gap:18px;align-items:start}.content.detailed{grid-template-columns:minmax(0,1fr) 300px}.table-card,.detail{overflow:hidden}.table-card>header{padding:17px 19px;border-bottom:1px solid var(--rdx-border)}.table-card h2{margin:0;font-size:15px}.table-card header p{margin:4px 0 0;color:var(--rdx-text-muted);font-size:10px}.table-scroll{max-width:100%;overflow-x:auto}table{width:100%;min-width:850px;border-collapse:collapse}th{padding:11px 12px;background:#f8faf9;color:var(--rdx-text-muted);font-size:9px;text-align:left;text-transform:uppercase;white-space:nowrap}td{padding:12px;border-top:1px solid #edf1ef;font-size:10px}tbody tr{cursor:pointer}tbody tr:hover,tbody tr:focus,tbody tr.selected{outline:0;background:#f0f8f4}.device{align-items:center;gap:9px;min-width:175px}.device>i{display:grid;place-items:center;width:33px;height:33px;border-radius:7px;background:#edf6f2;color:var(--rdx-accent);font-style:normal}.device span{display:grid;gap:3px}.device strong{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.device small,.date{display:block;color:var(--rdx-text-faint);font-size:8px}.provider{padding:4px 7px;border-radius:4px;background:#eef4f1;color:#536a62;font-size:8px;text-transform:uppercase}.status{align-items:center;gap:6px;white-space:nowrap;font-size:9px;font-weight:700;color:#75827e}.status i{width:7px;height:7px;border-radius:50%;background:#8d9a95}.state-online{color:#157c58}.state-online i{background:#1b976c}.state-offline{color:#b84f45}.state-offline i{background:#df5b4f}.state-alarm{color:#b97508}.state-alarm i{background:#ee9d19}.power,td>strong{font-weight:700;white-space:nowrap}.date{margin-top:3px}.row-action{border:0;background:transparent;color:var(--rdx-accent);font-size:21px;cursor:pointer}.pagination{justify-content:space-between;align-items:center;padding:12px 18px;border-top:1px solid var(--rdx-border);color:var(--rdx-text-muted);font-size:10px}.pagination div{gap:5px}.pagination button,.pagination b{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--rdx-border);border-radius:6px;background:#fff}.pagination b{background:var(--rdx-accent);color:#fff}.detail{position:sticky;top:18px}.detail header{justify-content:space-between;padding:18px;border-bottom:1px solid var(--rdx-border)}.detail header span{color:var(--rdx-text-muted);font-size:9px}.detail h2{margin:4px 0 0;font-size:16px}.detail header button{border:0;background:transparent;color:var(--rdx-text-muted);font-size:24px;cursor:pointer}.detail-hero{justify-content:space-between;align-items:center;padding:19px 18px}.device-picture{width:62px;height:62px;border-radius:12px;font-size:25px}.detail dl{margin:0;padding:0 18px}.detail dl div{display:flex;justify-content:space-between;gap:15px;padding:10px 0;border-bottom:1px solid #edf1ef}.detail dt{color:var(--rdx-text-muted);font-size:9px}.detail dd{margin:0;max-width:58%;font-size:10px;font-weight:700;text-align:right;overflow-wrap:anywhere}.telemetry{margin:16px 18px 0;padding:13px;border-radius:8px;background:#f5f9f7}.telemetry h3{margin:0 0 10px;font-size:11px}.telemetry p{display:flex;justify-content:space-between;gap:10px;margin:8px 0;font-size:9px}.telemetry span{color:var(--rdx-text-muted)}.detail>a{display:flex;justify-content:space-between;margin:18px;padding:11px;border-radius:7px;background:var(--rdx-accent);color:#fff;font-size:10px;font-weight:700;text-decoration:none}.feedback,.empty{padding:26px}.error,.inline-error{color:#a7443b}.inline-error{padding:10px;border:1px solid #f0c4bf;border-radius:7px;background:#fff5f3}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:1200px){.summary-grid{grid-template-columns:repeat(2,1fr)}.filters{grid-template-columns:repeat(4,minmax(0,1fr))}.search{grid-column:span 2}.content.detailed{grid-template-columns:minmax(0,1fr) 280px}}
@media(max-width:900px){.content.detailed{grid-template-columns:1fr}.detail{position:fixed;z-index:1200;left:14px;right:14px;bottom:14px;top:auto;max-height:calc(100vh - 28px);overflow-y:auto;box-shadow:0 18px 60px rgba(13,43,34,.25)}}
@media(max-width:680px){.devices-header{flex-direction:column}.header-actions{width:100%;justify-content:space-between}.header-actions p{text-align:left}.filters{grid-template-columns:repeat(2,1fr)}.search{grid-column:1/-1}.summary-grid article{min-height:88px;padding:13px}}
@media(max-width:420px){.summary-grid,.filters{grid-template-columns:1fr}.search{grid-column:auto}.summary-grid article{min-height:76px}.header-actions button{padding:0 10px}}
</style>
