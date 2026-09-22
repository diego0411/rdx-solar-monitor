<script setup>
import { ref, watch, computed } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '../services/api.js';
import { deviceDisplayName } from '../utils/deviceDisplay.js';
import PlantPowerCurve from '../components/PlantPowerCurve.vue';
import PlantEnergyHistory from '../components/PlantEnergyHistory.vue';
import PlantEnergyFlow from '../components/PlantEnergyFlow.vue';

const route = useRoute();
const detail = ref(null), loading = ref(true), error = ref(''), notFound = ref(false);
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
const kpiAcPower = computed(() => realtime.value.ac_power);
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

const energyRows = computed(() => [
  {
    label: 'Generación',
    hoy: energy.value.today_generation_kwh,
    mes: energy.value.month_generation_kwh,
    año: energy.value.year_generation_kwh,
    total: energy.value.total_generation_kwh,
  },
  {
    label: 'Consumo',
    hoy: energy.value.today_consumption_kwh,
    mes: energy.value.month_consumption_kwh,
    año: energy.value.year_consumption_kwh,
    total: energy.value.total_consumption_kwh,
  },
]);

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
  <div class="detail-page">
    <header class="plant-head">
      <RouterLink class="back-link" to="/plants">← Volver a plantas</RouterLink>

      <div class="head-row">
        <h1>{{ plant?.name ?? 'Detalle de planta' }}</h1>
        <span v-if="providerName" class="provider">{{ providerName }}</span>
      </div>

      <dl
        v-if="detail"
        class="head-meta"
      >
        <div>
          <dt>Capacidad</dt>
          <dd>{{ number(plant?.capacity_kwp, 'kWp') }}</dd>
        </div>
        <div>
          <dt>Estado</dt>
          <dd>
            <span class="badge" :class="`state-${plant?.status}`">
              {{ statuses[plant?.status] ?? statuses.unknown }}
            </span>
          </dd>
        </div>
        <div>
          <dt>Telemetría</dt>
          <dd>
            <span class="badge" :class="`data-${realtime.data_status}`">
              {{ freshLabel }}
            </span>
          </dd>
        </div>
        <div>
          <dt>Última lectura</dt>
          <dd>{{ lastRead }}</dd>
        </div>
      </dl>
    </header>

    <div v-if="loading" class="card" role="status">Cargando detalle de planta…</div>
    <div v-else-if="notFound" class="card" role="alert"><h2>Planta no encontrada</h2><p>No existe una planta con este identificador. Vuelve al listado para seleccionar otra.</p></div>
    <div v-else-if="error" class="card" role="alert">{{ error }}</div>

    <div v-else-if="detail" class="sections">
      <section class="kpi-grid" aria-label="Resumen principal">
        <article class="card kpi">
          <span class="kpi-label">Generación hoy</span>
          <strong>{{ number(kpiGeneration, 'kWh') }}</strong>
        </article>
        <article class="card kpi">
          <span class="kpi-label">Consumo hoy</span>
          <strong>{{ number(kpiConsumption, 'kWh') }}</strong>
        </article>
        <article class="card kpi">
          <span class="kpi-label">Potencia fotovoltaica actual</span>
          <strong>{{ number(kpiPvPower, 'W') }}</strong>
        </article>
        <article class="card kpi">
          <span class="kpi-label">Potencia AC actual</span>
          <strong>{{ number(kpiAcPower, 'W') }}</strong>
        </article>
      </section>

      <section class="section" aria-labelledby="flow-title">
        <div class="section-head">
          <h2 id="flow-title">Flujo energético</h2>
          <span class="badge" :class="`data-${realtime.data_status}`">{{ freshLabel }}</span>
        </div>
        <p v-if="realtime.data_status === 'stale'" class="stale-notice" role="note"><strong>Telemetría desactualizada.</strong> Los valores corresponden a la última lectura conocida y pueden diferir de la potencia actual.</p>
        <p v-if="!hasFlowData" class="muted">Sin datos de telemetría.</p>
        <PlantEnergyFlow v-else :realtime="realtime" />
      </section>

      <section class="card section" aria-labelledby="perf-title">
        <div class="section-head">
          <h2 id="perf-title">Rendimiento</h2>
        </div>
        <div class="perf-table">
          <div class="perf-row perf-head">
            <span class="perf-name">Energía</span>
            <span>Hoy</span>
            <span>Mes</span>
            <span>Año</span>
            <span>Total</span>
          </div>
          <div
            v-for="row in energyRows"
            :key="row.label"
            class="perf-row"
          >
            <span class="perf-name">{{ row.label }}</span>
            <span>{{ number(row.hoy, 'kWh') }}</span>
            <span>{{ number(row.mes, 'kWh') }}</span>
            <span>{{ number(row.año, 'kWh') }}</span>
            <span>{{ number(row.total, 'kWh') }}</span>
          </div>
        </div>
      </section>

      <PlantPowerCurve :plant-id="String(route.params.id)" :timezone="detail.plant.timezone" />
      <PlantEnergyHistory :plant-id="String(route.params.id)" :timezone="detail.plant.timezone" />

      <section class="section" aria-labelledby="devices-title">
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

      <section class="card section" aria-labelledby="install-title">
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
.detail-page { min-width: 0; }
h1 { margin: 0; overflow-wrap: anywhere; font-size: clamp(22px, 3vw, 30px); letter-spacing: -.02em; }
h2 { margin: 0; font-size: 18px; letter-spacing: -.01em; }
dt, .kpi-label, .device-type, .count, small { font-size: 12px; color: var(--rdx-text-muted); font-weight: 600; }
dd { margin: 4px 0 0; overflow-wrap: anywhere; font-weight: 600; font-variant-numeric: tabular-nums; }

.plant-head { margin-bottom: 26px; }
.head-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 4px 0 14px; }
.provider { text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 700; color: var(--rdx-primary); background: var(--rdx-success-soft); border-radius: 6px; padding: 4px 8px; }
.head-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 14px 28px; margin: 0; padding-top: 16px; border-top: 1px solid var(--rdx-border); }

.badge { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 20px; font-weight: 600; line-height: 1.5; font-size: 12px; }
.badge::before { content: ''; width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: currentColor; }

.sections { display: grid; gap: 30px; min-width: 0; }
.sections > section { min-width: 0; }
.section.card { padding: 20px; }
.sections > section:not(.card) { border-top: 1px solid var(--rdx-border); padding-top: 24px; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.count { background: var(--rdx-neutral-soft); color: var(--rdx-text-muted); border-radius: 20px; padding: 3px 10px; min-width: 28px; text-align: center; }
.muted { color: var(--rdx-text-muted); font-size: 14px; margin: 12px 0 0; }

.kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.kpi { padding: 18px; }
.kpi-label { display: block; line-height: 1.4; margin-bottom: 10px; }
.kpi strong { display: block; font-size: clamp(20px, 2.4vw, 26px); font-weight: 700; color: var(--rdx-primary); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; line-height: 1.2; }

.stale-notice { margin: 0 0 16px; padding: 12px 16px; border: 1px solid var(--rdx-warning-soft); border-left: 3px solid var(--rdx-warning); border-radius: 8px; background: var(--rdx-warning-soft); color: var(--rdx-warning); font-size: 13px; line-height: 1.5; }

.perf-table { display: grid; gap: 0; }
.perf-row { display: grid; grid-template-columns: minmax(110px, 1.3fr) repeat(4, minmax(0, 1fr)); align-items: center; padding: 10px 14px; border-radius: 8px; }
.perf-row > span { text-align: right; font-variant-numeric: tabular-nums; color: var(--rdx-text); font-weight: 600; font-size: 14px; }
.perf-row > .perf-name { text-align: left; font-weight: 600; color: var(--rdx-text); }
.perf-head { background: var(--rdx-primary-soft); }
.perf-head > span { color: var(--rdx-accent); font-size: 12px; font-weight: 700; letter-spacing: .03em; }
.perf-row + .perf-row { margin-top: 4px; }

.device-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.device-card { padding: 16px 18px; }
.device-top { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.device-top h3 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
.device-top a { color: var(--rdx-primary); text-decoration: none; }
.device-top a:hover { text-decoration: underline; }
.device-top a:focus-visible { outline: 3px solid var(--rdx-focus); outline-offset: 3px; border-radius: 4px; }
.device-type { background: var(--rdx-primary-soft); color: var(--rdx-accent); border-radius: 20px; padding: 3px 10px; }
.device-model { margin: 4px 0 0; color: var(--rdx-text-muted); font-size: 13px; overflow-wrap: anywhere; }
.device-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: 10px 24px; margin: 12px 0 0; padding-top: 12px; border-top: 1px solid var(--rdx-border); }
.device-meta .badge { font-size: 12px; }

.install-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr)); gap: 16px 28px; margin: 0; }
.install-address { grid-column: 1 / -1; }

.empty-note { padding: 18px; }

@media (max-width: 900px) {
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 600px) {
  .sections { gap: 26px; }
  .perf-row { grid-template-columns: minmax(76px, 1.2fr) repeat(4, minmax(0, 1fr)); padding: 9px 8px; gap: 4px; }
  .perf-row > span { font-size: 13px; }
  .device-meta { gap: 8px 16px; }
}

@media (max-width: 420px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .install-address { grid-column: auto; }
}
</style>