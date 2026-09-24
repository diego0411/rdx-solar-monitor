<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '../services/api.js';
import { deviceDisplayName } from '../utils/deviceDisplay.js';
import PlantPowerCurve from '../components/PlantPowerCurve.vue';
import PlantEnergyHistory from '../components/PlantEnergyHistory.vue';
import PlantEnergyFlow from '../components/PlantEnergyFlow.vue';
import PlantEconomics from '../components/PlantEconomics.vue';

const route = useRoute();
const detail = ref(null), loading = ref(true), error = ref(''), notFound = ref(false);
const today = new Date();
const historyPeriod = ref('day');
const historyDate = ref(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
const historyResponse = ref(null);
const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };
const statuses = {
  online: 'En línea', offline: 'Sin conexión', alarm: 'Alarma',
  inactive: 'Inactiva', unknown: 'Desconocido',
};
const freshness = { fresh: 'Actual', stale: 'Atrasada', no_data: 'Sin datos' };
const deviceTypeLabels = {
  STRING_INVERTER: 'Inversor',
  HYBRID_INVERTER: 'Inversor híbrido',
  COLLECTOR: 'Comunicador',
};
const growattPlantTypes = {
  residential: 'Residencial', commercial: 'Comercial', ground_mounted: 'Suelo',
};
const flowKeys = [
  'pv_power', 'ac_power', 'load_power',
  'grid_import_power', 'grid_export_power', 'current_grid_power',
  'battery_charge_power', 'battery_discharge_power',
  'battery_power_w', 'battery_soc',
];

const plant = computed(() => detail.value?.plant ?? null);
const energy = computed(() => detail.value?.energy ?? {});
const realtime = computed(() => detail.value?.realtime ?? {});
const devices = computed(() => detail.value?.devices ?? []);
const kpiGeneration = computed(() => energy.value.today_generation_kwh);
const kpiConsumption = computed(() => energy.value.today_consumption_kwh);
const kpiPvPower = computed(() => realtime.value.pv_power);
const freshLabel = computed(() => freshness[realtime.value.data_status] ?? freshness.no_data);
const providerName = computed(() =>
  plant.value
    ? (providerNames[plant.value.provider] ?? plant.value.provider ?? '—')
    : '');
const plantTypeLabel = computed(() => {
  const type = plant.value?.plant_type;
  if (plant.value?.provider === 'growatt' && type) {
    return growattPlantTypes[type] ?? null;
  }
  return null;
});
const lastRead = computed(() => {
  const minutes = realtime.value.data_age_minutes;
  if (minutes != null && Number.isFinite(minutes)) {
    return age(minutes);
  }
  if (plant.value?.last_data_at) {
    return date(plant.value.last_data_at);
  }
  return '—';
});
const hasFlowData = computed(() =>
  flowKeys.some(key => {
    const value = realtime.value[key];
    return typeof value === 'number' && Number.isFinite(value);
  }));

function number(value, unit = '', digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  let raw = value;
  let suffix = unit;
  if (unit === 'W' && Math.abs(raw) >= 1000) {
    raw /= 1000;
    suffix = 'kW';
  }
  const formatted = new Intl.NumberFormat('es-BO', { maximumFractionDigits: digits }).format(raw);
  return `${formatted}${suffix ? ` ${suffix}` : ''}`;
}

function date(value) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : '—';
}

function age(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value < 60
    ? `Hace ${number(value)} min`
    : `Hace ${number(value / 60, '', 1)} h`;
}

function deviceRank(device) {
  const type = String(device?.device_type ?? '').toUpperCase();
  return type.includes('INVERTER') || type === 'MIN' ? 0 : 1;
}

const sortedDevices = computed(() =>
  [...devices.value].sort((a, b) =>
    deviceRank(a) - deviceRank(b)
    || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es', { sensitivity: 'base' })
    || String(a.id).localeCompare(String(b.id))));

function deviceTypeChip(device) {
  const raw = device?.device_type;
  if (raw == null || String(raw).trim() === '') return null;
  const type = String(raw).toUpperCase();
  return deviceTypeLabels[type] ?? raw;
}

function deviceModelLine(device) {
  if (!device?.model) return null;
  if (device.name && String(device.model) === String(device.name)) return null;
  return device.model;
}

const periodNames = { day: 'Día', week: 'Semana', month: 'Mes', year: 'Año' };
const historyFields = [
  ['generation_kwh', 'Generación', 'generation'],
  ['consumption_kwh', 'Consumo', 'consumption'],
  ['grid_import_kwh', 'Importación', 'import'],
  ['grid_export_kwh', 'Exportación', 'export'],
];
const energyRows = computed(() => historyFields.map(([field, label, tone]) => {
  const values = (historyResponse.value?.buckets ?? [])
    .map(bucket => bucket[field])
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  return { label, tone, value: values.length ? values.reduce((sum, value) => sum + value, 0) : null };
}));
const historyCoverage = computed(() => {
  const buckets = historyResponse.value?.buckets ?? [];
  if (!buckets.length || buckets.every(bucket => bucket.coverage === 'none')) return 'Sin datos';
  return buckets.some(bucket => bucket.coverage === 'partial' || bucket.coverage === 'none') ? 'Cobertura parcial' : 'Cobertura disponible';
});

watch(() => route.params.id, async (id, previous, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  loading.value = true;
  error.value = '';
  notFound.value = false;
  detail.value = null;
  historyResponse.value = null;
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
  <div class="detail-page">
    <header class="plant-head">
      <RouterLink class="back-link" to="/plants">← Volver a plantas</RouterLink>

      <div v-if="detail" class="head-row">
        <span class="provider-mark">{{ providerName }}</span>
        <div class="head-identity">
          <h1>{{ plant?.name ?? 'Detalle de planta' }}</h1>
          <p>
            <strong>{{ providerName }}</strong>
            <span v-if="plant?.external_plant_id">· {{ plant.external_plant_id }}</span>
          </p>
        </div>
        <div class="head-status">
          <span class="badge" :class="`state-${plant?.status}`">
            {{ statuses[plant?.status] ?? statuses.unknown }}
          </span>
          <small>Última lectura: {{ lastRead }}</small>
        </div>
      </div>
    </header>

    <div v-if="loading" class="card" role="status">Cargando detalle de planta…</div>
    <div v-else-if="notFound" class="card" role="alert"><h2>Planta no encontrada</h2><p>No existe una planta con este identificador. Vuelve al listado para seleccionar otra.</p></div>
    <div v-else-if="error" class="card" role="alert">{{ error }}</div>

    <div class="sections">
      <section v-if="detail" class="kpi-grid" aria-label="Resumen principal">
        <article class="card kpi">
          <span class="kpi-icon" aria-hidden="true">ϟ</span>
          <div><span class="kpi-label">Potencia actual</span>
          <strong>{{ number(kpiPvPower, 'W') }}</strong></div>
        </article>
        <article class="card kpi">
          <span class="kpi-icon" aria-hidden="true">▥</span>
          <div><span class="kpi-label">Generación hoy</span>
          <strong>{{ number(kpiGeneration, 'kWh') }}</strong></div>
        </article>
        <article class="card kpi">
          <span class="kpi-icon" aria-hidden="true">⌂</span>
          <div><span class="kpi-label">Consumo hoy</span>
          <strong>{{ number(kpiConsumption, 'kWh') }}</strong></div>
        </article>
        <article class="card kpi">
          <span class="kpi-icon" aria-hidden="true">▦</span>
          <div><span class="kpi-label">Capacidad instalada</span>
          <strong>{{ number(plant?.capacity_kwp, 'kWp') }}</strong></div>
        </article>
      </section>

      <section v-if="detail" class="card section flow-section" aria-labelledby="flow-title">
        <div class="section-head">
          <h2 id="flow-title">Flujo energético</h2>
          <span class="badge" :class="`data-${realtime.data_status}`">{{ freshLabel }}</span>
        </div>
        <p v-if="realtime.data_status === 'stale'" class="stale-notice" role="note"><strong>Telemetría desactualizada.</strong> Los valores corresponden a la última lectura conocida y pueden diferir de la potencia actual.</p>
        <p v-if="!hasFlowData" class="muted">Sin datos de telemetría.</p>
        <PlantEnergyFlow v-else :realtime="realtime" />
      </section>

      <section v-if="detail" class="card section status-section" aria-labelledby="status-title">
        <div class="section-head">
          <h2 id="status-title">Estado y datos</h2>
        </div>
        <dl class="status-data">
          <div><dt>Estado de planta</dt><dd><span class="badge" :class="`state-${plant?.status}`">{{ statuses[plant?.status] ?? statuses.unknown }}</span></dd></div>
          <div><dt>Estado de telemetría</dt><dd><span class="badge" :class="`data-${realtime.data_status}`">{{ freshLabel }}</span></dd></div>
          <div><dt>Última lectura</dt><dd>{{ lastRead }}</dd></div>
          <div><dt>Total de dispositivos</dt><dd>{{ devices.length }}</dd></div>
          <div><dt>Proveedor</dt><dd>{{ providerName || '—' }}</dd></div>
          <div v-if="plant?.external_plant_id"><dt>ID de planta</dt><dd>{{ plant.external_plant_id }}</dd></div>
        </dl>
      </section>

      <section v-if="historyResponse" class="card section performance-section" aria-labelledby="perf-title">
        <div class="section-head">
          <div>
            <h2 id="perf-title">Rendimiento</h2>
            <p>{{ periodNames[historyPeriod] }} · {{ historyCoverage }}</p>
          </div>
        </div>
        <div class="perf-table">
          <div class="perf-row perf-head">
            <span class="perf-name">Energía</span>
            <span>Periodo seleccionado</span>
          </div>
          <div
            v-for="row in energyRows"
            :key="row.label"
            class="perf-row"
          >
            <span class="perf-name"><i :class="`tone-${row.tone}`" />{{ row.label }}</span>
            <span>{{ number(row.value, 'kWh') }}</span>
          </div>
        </div>
      </section>

      <PlantPowerCurve v-model:period="historyPeriod" v-model:selected-date="historyDate" :plant-id="String(route.params.id)" :timezone="plant?.timezone" />
      <PlantEnergyHistory v-model:period="historyPeriod" v-model:selected-date="historyDate" :plant-id="String(route.params.id)" :timezone="plant?.timezone" @history-loaded="historyResponse = $event" />
      <PlantEconomics
        v-if="detail"
        :plant-id="String(route.params.id)"
        :period="historyPeriod"
        :selected-date="historyDate"
      />

      <section v-if="detail" class="card section devices-section" aria-labelledby="devices-title">
        <div class="section-head">
          <h2 id="devices-title">Dispositivos</h2>
          <span class="count">{{ devices.length }}</span>
        </div>
        <p v-if="!devices.length" class="card empty-note">No hay dispositivos registrados para esta planta.</p>
        <ul v-else class="device-list">
          <li
            v-for="device in sortedDevices"
            :key="device.id"
            class="card device-card"
          >
            <div class="device-top">
              <h3>
                <RouterLink :to="`/devices/${device.id}`">
                  {{ deviceDisplayName(device) }} →
                </RouterLink>
              </h3>
              <span v-if="deviceTypeChip(device)" class="device-type">{{ deviceTypeChip(device) }}</span>
            </div>
            <p v-if="deviceModelLine(device)" class="device-model">{{ deviceModelLine(device) }}</p>
            <dl class="device-meta">
              <div><dt>Serial</dt><dd>{{ device.serial_number ?? '—' }}</dd></div>
              <div>
                <dt>Estado</dt>
                <dd><span class="badge" :class="`state-${device.status}`">{{ statuses[device.status] ?? statuses.unknown }}</span></dd>
              </div>
              <div><dt>Potencia nominal</dt><dd>{{ number(device.rated_power_w, 'W') }}</dd></div>
              <div><dt>Última lectura</dt><dd>{{ date(device.last_data_at) }}</dd></div>
            </dl>
          </li>
        </ul>
      </section>

      <section v-if="detail" class="card section install-section" aria-labelledby="install-title">
        <div class="section-head">
          <h2 id="install-title">Información de instalación</h2>
        </div>
        <dl class="install-grid">
          <div><dt>Proveedor</dt><dd>{{ providerName || '—' }}</dd></div>
          <div><dt>Capacidad</dt><dd>{{ number(plant?.capacity_kwp, 'kWp') }}</dd></div>
          <div><dt>Zona horaria</dt><dd>{{ plant?.timezone ?? '—' }}</dd></div>
          <div v-if="plantTypeLabel"><dt>Tipo de planta</dt><dd>{{ plantTypeLabel }}</dd></div>
          <div class="install-address"><dt>Dirección</dt><dd>{{ plant?.address ?? '—' }}</dd></div>
          <div><dt>Latitud</dt><dd>{{ number(plant?.latitude, '', 5) }}</dd></div>
          <div><dt>Longitud</dt><dd>{{ number(plant?.longitude, '', 5) }}</dd></div>
        </dl>
      </section>
    </div>
  </div>
</template>

<style scoped>
.detail-page { min-width: 0; width: 100%; }
h1 { margin: 0; overflow-wrap: anywhere; font-size: clamp(23px, 2.4vw, 29px); letter-spacing: -.025em; }
h2 { margin: 0; font-size: 17px; letter-spacing: -.015em; }
dt, .kpi-label, .device-type, .count, small { color: var(--rdx-text-muted); font-size: 11px; font-weight: 500; }
dd { margin: 3px 0 0; overflow-wrap: anywhere; color: var(--rdx-text-strong); font-weight: 600; font-variant-numeric: tabular-nums; }
.plant-head { margin-bottom: 14px; }
.back-link { margin-bottom: 14px; color: var(--rdx-text); font-size: 13px; }
.head-row { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; align-items: center; gap: 16px; }
.provider-mark { display: grid; place-items: center; width: 72px; height: 72px; border: 1px solid var(--rdx-border); border-radius: 50%; background: var(--rdx-surface); color: var(--rdx-primary); box-shadow: var(--rdx-shadow-sm); font-size: 17px; font-weight: 800; }
.head-identity { min-width: 0; }
.head-identity p { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 0; color: var(--rdx-text-muted); font-size: 12px; overflow-wrap: anywhere; }
.head-identity p strong { color: var(--rdx-text); }
.head-status { display: grid; justify-items: end; gap: 8px; text-align: right; }
.badge { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.5; }
.badge::before { content: ''; width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: currentColor; }
.sections { display: grid; grid-template-columns: minmax(0, 2fr) minmax(290px, 1fr); gap: 14px; min-width: 0; }
.sections > * { min-width: 0; }
.section.card { padding: 16px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.section-head p { margin: 2px 0 0; color: var(--rdx-text-muted); font-size: 11px; }
.count { min-width: 28px; padding: 3px 10px; border-radius: 20px; background: var(--rdx-neutral-soft); text-align: center; }
.muted { margin: 12px 0 0; color: var(--rdx-text-muted); font-size: 13px; }
.kpi-grid { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.kpi { display: flex; align-items: center; gap: 14px; min-height: 94px; padding: 16px; }
.kpi-icon { display: grid; place-items: center; flex: 0 0 48px; width: 48px; height: 48px; border-radius: 13px; background: var(--rdx-success-soft); color: var(--rdx-success); font-size: 27px; }
.kpi > div { min-width: 0; }
.kpi-label { display: block; margin-bottom: 3px; line-height: 1.4; }
.kpi strong { display: block; color: var(--rdx-text-strong); font-size: clamp(19px, 2vw, 25px); font-weight: 650; line-height: 1.2; overflow-wrap: anywhere; }
.flow-section { grid-column: 1; }
.status-section { grid-column: 2; }
.performance-section { grid-column: 2; }
.sections :deep(.power-section) { grid-column: 1; grid-row: 3; padding: 16px; }
.sections :deep(.energy-section) { grid-column: 1 / -1; padding: 16px; }
.devices-section { grid-column: 1; }
.install-section { grid-column: 2; }
.flow-section :deep(.energy-flow) { margin: 0; padding: 10px 4px 2px; border: 0; background: transparent; }
.flow-section :deep(.flow-header) { display: none; }
.flow-section :deep(.flow-node) { min-height: 76px; padding: 12px; border-top-width: 1px; box-shadow: var(--rdx-shadow-sm); }
.flow-section :deep(.flow-diagram) { grid-template-columns: minmax(110px, 1fr) minmax(62px, .55fr) minmax(125px, 1fr) minmax(68px, .6fr) minmax(110px, 1fr); gap: 10px 8px; }
.stale-notice { margin: 0 0 10px; padding: 9px 12px; border-left: 3px solid var(--rdx-warning); border-radius: var(--rdx-radius-sm); background: var(--rdx-warning-soft); color: var(--rdx-warning); font-size: 11px; line-height: 1.5; }
.status-data { margin: 0; }
.status-data > div { display: grid; grid-template-columns: minmax(115px, 1fr) minmax(0, 1fr); align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--rdx-neutral-soft); }
.status-data > div:last-child { border-bottom: 0; }
.status-data dt { font-size: 12px; }
.status-data dd { margin: 0; font-size: 12px; text-align: left; }
.perf-table { display: grid; }
.perf-row { display: grid; grid-template-columns: minmax(110px, 1.2fr) minmax(0, 1fr); align-items: center; gap: 8px; padding: 10px 7px; border-bottom: 1px solid var(--rdx-neutral-soft); }
.perf-row > span { color: var(--rdx-text); font-size: 11px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.perf-row > .perf-name { text-align: left; }
.perf-name { display: flex; align-items: center; gap: 6px; }
.perf-name i { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%; }
.tone-generation { background: var(--rdx-success); }
.tone-consumption { background: var(--rdx-warning); }
.tone-import { background: var(--rdx-primary); }
.tone-export { background: var(--rdx-accent); }
.perf-head { border-radius: var(--rdx-radius-sm); border-bottom: 0; background: var(--rdx-background); }
.perf-head > span { color: var(--rdx-text-muted); font-size: 10px; }
.device-list { display: grid; gap: 0; margin: 0; padding: 0; border: 1px solid var(--rdx-neutral-soft); border-radius: var(--rdx-radius-sm); list-style: none; overflow: hidden; }
.device-card { padding: 12px; border: 0; border-bottom: 1px solid var(--rdx-neutral-soft); border-radius: 0; box-shadow: none; }
.device-list > li:last-child { border-bottom: 0; }
.device-top { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.device-top h3 { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
.device-top a { color: var(--rdx-text-strong); }
.device-top a:hover { color: var(--rdx-primary); text-decoration: underline; }
.device-type { padding: 2px 8px; border-radius: 20px; background: var(--rdx-primary-soft); color: var(--rdx-accent); }
.device-model { margin: 2px 0 0; color: var(--rdx-text-muted); font-size: 11px; }
.device-meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--rdx-neutral-soft); }
.device-meta dt { font-size: 10px; }
.device-meta dd { font-size: 11px; }
.device-meta .badge { padding: 2px 7px; font-size: 10px; }
.install-grid { display: grid; gap: 0; margin: 0; }
.install-grid > div { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(0, 1.2fr); gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--rdx-neutral-soft); }
.install-grid > div:last-child { border-bottom: 0; }
.install-grid dt, .install-grid dd { font-size: 11px; }
.empty-note { padding: 18px; }
@media (max-width: 1199px) {
  .sections { grid-template-columns: minmax(0, 1fr); }
  .kpi-grid, .flow-section, .status-section, .performance-section, .sections :deep(.power-section), .sections :deep(.energy-section), .devices-section, .install-section { grid-column: 1; grid-row: auto; }
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .flow-section :deep(.flow-diagram) { grid-template-columns: minmax(0, 260px); }
  .flow-section :deep(.flow-diagram > *) { grid-column: 1; grid-row: auto; }
}
@media (max-width: 767px) {
  .head-row { grid-template-columns: 58px minmax(0, 1fr); }
  .provider-mark { width: 54px; height: 54px; font-size: 13px; }
  .head-status { grid-column: 2; justify-items: start; text-align: left; }
  .device-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 479px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .kpi { min-height: 82px; }
  .section.card, .sections :deep(.power-section), .sections :deep(.energy-section) { padding: 14px; }
  .status-data > div, .install-grid > div { grid-template-columns: 1fr; gap: 2px; }
  .device-meta { grid-template-columns: 1fr; }
}
</style>
