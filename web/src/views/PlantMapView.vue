<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiFetch } from '../services/api.js';
import { rdxColor } from '../utils/rdxTokens.js';

const router = useRouter();
const mapElement = ref(null);
const loading = ref(true);
const error = ref('');
const plants = ref([]);

const search = ref('');
const provider = ref('');
const status = ref('');

const controller = new AbortController();

const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };

const statuses = {
  online: 'En línea',
  offline: 'Sin conexión',
  alarm: 'Alarma',
  inactive: 'Inactiva',
  unknown: 'Desconocido',
};

const freshness = {
  fresh: 'Actual',
  stale: 'Atrasada',
  no_data: 'Sin datos',
};

const badgeStyles = {
  online: [rdxColor('--rdx-success-soft'), rdxColor('--rdx-success')],
  offline: [rdxColor('--rdx-danger-soft'), rdxColor('--rdx-danger')],
  alarm: [rdxColor('--rdx-warning-soft'), rdxColor('--rdx-warning')],
  inactive: [rdxColor('--rdx-neutral-soft'), rdxColor('--rdx-text-muted')],
  unknown: [rdxColor('--rdx-neutral-soft'), rdxColor('--rdx-text-muted')],
};

const freshnessStyles = {
  fresh: [rdxColor('--rdx-success-soft'), rdxColor('--rdx-success')],
  stale: [rdxColor('--rdx-warning-soft'), rdxColor('--rdx-warning')],
  no_data: [rdxColor('--rdx-neutral-soft'), rdxColor('--rdx-text-muted')],
};

const markerColors = {
  online: rdxColor('--rdx-success'),
  alarm: rdxColor('--rdx-warning'),
  offline: rdxColor('--rdx-danger'),
  inactive: rdxColor('--rdx-text-faint'),
  unknown: rdxColor('--rdx-text-faint'),
};

const number = new Intl.NumberFormat('es-BO', {
  maximumFractionDigits: 2,
});
const dateTime = new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeStyle: 'short' });

let map = null;
let markerLayer = null;

function coordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function markerColor(value) {
  return markerColors[value] ?? markerColors.unknown;
}

function power(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'Sin datos';
  const watts = Number(value);
  return watts < 1000
    ? `${number.format(watts)} W`
    : `${number.format(Number((watts / 1000).toFixed(2)))} kW`;
}

function energy(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'Sin datos';
  return `${number.format(Number(value))} kWh`;
}

function capacity(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'Sin datos';
  return `${number.format(Number(value))} kWp`;
}

function ageMinutes(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const minutes = Number(value);
  return minutes < 60
    ? `hace ${number.format(Math.max(0, Math.round(minutes)))} min`
    : `hace ${number.format(Number((minutes / 60).toFixed(1)))} h`;
}

function badge(text, background, color) {
  const span = document.createElement('span');
  span.textContent = text;
  span.style.display = 'inline-block';
  span.style.padding = '2px 8px';
  span.style.margin = '0 4px 4px 0';
  span.style.borderRadius = '6px';
  span.style.background = background;
  span.style.color = color;
  span.style.fontSize = '11px';
  span.style.fontWeight = '600';
  return span;
}

function line(label, value) {
  const div = document.createElement('div');
  div.className = 'map-popup-line';
  const name = document.createElement('span');
  name.textContent = label;
  const data = document.createElement('strong');
  data.textContent = value;
  div.append(name, data);
  return div;
}

function popupFor(plant) {
  const content = document.createElement('div');
  content.className = 'map-popup';

  const title = document.createElement('strong');
  title.textContent = plant.name ?? 'Planta sin nombre';
  title.className = 'map-popup-title';
  content.append(title);

  const badgesRow = document.createElement('div');
  badgesRow.append(badge(
    providerNames[plant.provider] ?? plant.provider ?? 'Desconocido',
    rdxColor('--rdx-primary-soft'),
    rdxColor('--rdx-accent'),
  ));
  badgesRow.append(badge(
    statuses[plant.status] ?? statuses.unknown,
    ...(badgeStyles[plant.status] ?? badgeStyles.unknown),
  ));
  badgesRow.append(badge(
    freshness[plant.data_status] ?? freshness.no_data,
    ...(freshnessStyles[plant.data_status] ?? freshnessStyles.no_data),
  ));
  content.append(badgesRow);

  content.append(line('Capacidad', capacity(plant.capacity_kwp)));
  content.append(line('Potencia actual', power(plant.current_power_w)));
  content.append(line('Generación hoy', energy(plant.today_generation_kwh)));
  content.append(line('Última lectura', ageMinutes(plant.data_age_minutes) ?? 'Sin datos'));

  const link = document.createElement('a');
  link.href = router.resolve({ name: 'plant-detail', params: { id: plant.id } }).href;
  link.textContent = 'Ver detalle →';
  link.className = 'map-popup-link';
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void router.push({ name: 'plant-detail', params: { id: plant.id } });
  });
  content.append(link);

  return content;
}

const hasCoords = plant =>
  plant.latitude !== null && plant.longitude !== null;

const filteredAllPlants = computed(() => {
  const term = normalize(search.value.trim());
  return plants.value.filter(plant =>
    (!term || normalize(plant.name).includes(term))
    && (!provider.value || plant.provider === provider.value)
    && (!status.value || plant.status === status.value));
});

const plantsWithCoords = computed(() => plants.value.filter(hasCoords));
const filteredPlants = computed(() => filteredAllPlants.value.filter(hasCoords));
const plantsWithoutCoords = computed(() => filteredAllPlants.value.filter(plant => !hasCoords(plant)));
const plantSummary = computed(() => ({
  total: filteredAllPlants.value.length,
  online: filteredAllPlants.value.filter(plant => plant.status === 'online').length,
  offline: filteredAllPlants.value.filter(plant => plant.status === 'offline').length,
  alarm: filteredAllPlants.value.filter(plant => plant.status === 'alarm').length,
}));
const latestUpdated = computed(() => {
  const timestamps = plants.value.map(plant => plant.last_synced_at).filter(value => value && Number.isFinite(Date.parse(value)));
  if (!timestamps.length) return null;
  return dateTime.format(new Date(Math.max(...timestamps.map(Date.parse))));
});
const legendItems = computed(() => [
  ['online', 'En línea'], ['offline', 'Sin conexión'], ['alarm', 'Con alarmas'],
  ...(filteredAllPlants.value.some(plant => ['unknown', 'inactive'].includes(plant.status)) ? [['unknown', 'Desconocido']] : []),
]);

function renderMarkers({ fit = true } = {}) {
  if (!map) return;

  markerLayer.clearLayers();

  const positions = [];
  for (const plant of filteredPlants.value) {
    const position = [plant.latitude, plant.longitude];
    const marker = L.circleMarker(position, {
      radius: 10,
      color: '#ffffff',
      weight: 3,
      fillColor: markerColor(plant.status),
      fillOpacity: 1,
      className: 'plant-status-marker',
    });
    marker.bindPopup(popupFor(plant));
    marker.addTo(markerLayer);
    positions.push(position);
  }

  if (!fit) return;
  if (positions.length > 1) {
    map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], maxZoom: 12 });
  } else if (positions.length === 1) {
    map.setView(positions[0], 12);
  }
}

onMounted(async () => {
  let stored = null;
  let overviewById = new Map();

  function applyOverview() {
    if (controller.signal.aborted || stored === null) return;
    plants.value = stored.map(plant => {
      const info = overviewById.get(plant.id) ?? {};
      return {
        ...plant,
        latitude: coordinate(plant.latitude, -90, 90),
        longitude: coordinate(plant.longitude, -180, 180),
        data_status: info.data_status ?? 'no_data',
        data_age_minutes: info.data_age_minutes ?? null,
        current_power_w: info.current_power_w ?? null,
        today_generation_kwh: info.today_generation_kwh ?? null,
      };
    });
    renderMarkers({ fit: false });
  }

  // Attach the error handler immediately; neither request waits for the other.
  void apiFetch('/plants/overview', { signal: controller.signal })
    .then(data => {
      overviewById = new Map((Array.isArray(data) ? data : []).map(plant => [plant.id, plant]));
      applyOverview();
    })
    .catch(failure => {
      if (!controller.signal.aborted) {
        console.error('Mapa: fallo al cargar /plants/overview (modo degradado)', failure);
      }
    });

  try {
    const data = await apiFetch('/plants', { signal: controller.signal });
    stored = Array.isArray(data) ? data : [];
  } catch (failure) {
    if (!controller.signal.aborted) {
      console.error('Mapa: fallo al cargar /plants', failure);
    }
  }

  if (controller.signal.aborted) {
    loading.value = false;
    return;
  }

  if (stored === null) {
    loading.value = false;
    error.value = 'No se pudieron cargar las plantas del mapa.';
    return;
  }

  applyOverview();
  loading.value = false;

  if (!plantsWithCoords.value.length) return;
  await nextTick();
  if (controller.signal.aborted || !mapElement.value) return;

  map = L.map(mapElement.value);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.invalidateSize();
  renderMarkers();
});

watch(
  [search, provider, status],
  () => {
    if (map) renderMarkers();
  },
);

onUnmounted(() => {
  controller.abort();
  map?.remove();
  map = null;
  markerLayer = null;
});
</script>

<template>
  <div class="map-view">
    <header class="map-header">
      <div>
        <h1>Mapa de plantas</h1>
        <p>Ubicación y estado de todas las plantas fotovoltaicas</p>
      </div>
      <p v-if="latestUpdated" class="last-update">Última actualización: {{ latestUpdated }}</p>
    </header>

    <div v-if="loading" class="card page-state" role="status">Cargando mapa…</div>
    <div v-else-if="error" class="card page-state" role="alert">{{ error }}</div>

    <template v-else>
      <section class="summary-grid" aria-label="Resumen de plantas del mapa">
        <article class="summary-card"><span class="summary-icon">▦</span><div><span>Total de plantas</span><strong>{{ plantSummary.total }}</strong></div></article>
        <article class="summary-card"><span class="summary-icon tone-online"><i /></span><div><span>En línea</span><strong>{{ plantSummary.online }}</strong></div></article>
        <article class="summary-card"><span class="summary-icon tone-offline"><i /></span><div><span>Sin conexión</span><strong>{{ plantSummary.offline }}</strong></div></article>
        <article class="summary-card"><span class="summary-icon tone-alarm">!</span><div><span>Con alarmas</span><strong>{{ plantSummary.alarm }}</strong></div></article>
      </section>

      <section class="map-shell card">
        <form class="filters" aria-label="Filtros del mapa" @submit.prevent>
          <label class="search-filter"><span class="sr-only">Buscar por nombre</span><span class="search-icon" aria-hidden="true">⌕</span><input v-model="search" type="search" placeholder="Buscar plantas…" /></label>
          <label><span class="sr-only">Proveedor</span><select v-model="provider"><option value="">Todos los proveedores</option><option v-for="(label, key) in providerNames" :key="key" :value="key">{{ label }}</option></select></label>
          <label><span class="sr-only">Estado</span><select v-model="status"><option value="">Todos los estados</option><option v-for="(label, key) in statuses" :key="key" :value="key">{{ label }}</option></select></label>
          <span class="results-count" role="status">{{ filteredPlants.length }} en el mapa</span>
        </form>

        <div class="map-content">
          <div class="map-stage">
            <p v-if="plantsWithCoords.length && !filteredPlants.length" class="no-results" role="status">Sin plantas con ubicación para los filtros seleccionados.</p>
            <div v-if="plantsWithCoords.length" ref="mapElement" class="plant-map" aria-label="Mapa de plantas" />
            <p v-else class="map-empty">No hay plantas con coordenadas válidas.</p>
            <div v-if="plantsWithCoords.length" class="map-legend" aria-label="Leyenda del mapa">
              <span v-for="([key, label]) in legendItems" :key="key"><i :style="{ backgroundColor: markerColor(key) }" />{{ label }}</span>
            </div>
          </div>

          <aside class="no-location-panel" aria-labelledby="no-location-title">
            <header><h2 id="no-location-title">Plantas sin ubicación ({{ plantsWithoutCoords.length }})</h2></header>
            <p v-if="!plantsWithoutCoords.length" class="empty-note">No hay plantas sin ubicación para los filtros seleccionados.</p>
            <ul v-else>
              <li v-for="plant in plantsWithoutCoords" :key="plant.id">
                <RouterLink :to="`/plants/${plant.id}`">
                  <span class="plant-list-icon" :style="{ color: markerColor(plant.status) }">▦</span>
                  <span><strong>{{ plant.name ?? 'Planta sin nombre' }}</strong><small>{{ providerNames[plant.provider] ?? plant.provider ?? 'Desconocido' }} · {{ capacity(plant.capacity_kwp) }}</small><em><i :style="{ backgroundColor: markerColor(plant.status) }" />{{ statuses[plant.status] ?? statuses.unknown }}</em></span>
                </RouterLink>
              </li>
            </ul>
          </aside>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.map-view { width: 100%; min-width: 0; }
.map-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin: 0 4px 18px; }
.map-header h1 { margin: 0; color: var(--rdx-text-strong); font-size: 31px; letter-spacing: -.025em; }
.map-header p { margin: 3px 0 0; color: var(--rdx-text-muted); font-size: 14px; }
.last-update { flex: 0 0 auto; padding-bottom: 3px; font-size: 12px !important; }
.page-state { padding: 24px; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
.summary-card { display: flex; align-items: center; gap: 14px; min-height: 94px; padding: 16px 18px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-lg); background: var(--rdx-surface); box-shadow: var(--rdx-shadow-sm); }
.summary-card > div { display: grid; min-width: 0; }
.summary-card div span { color: var(--rdx-text); font-size: 12px; }
.summary-card strong { color: var(--rdx-text-strong); font-size: 28px; font-weight: 650; line-height: 1.1; }
.summary-icon { display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 48px; border-radius: 12px; background: var(--rdx-primary-soft); color: var(--rdx-primary); font-size: 25px; font-weight: 800; }
.summary-icon i { width: 20px; height: 20px; border-radius: 50%; background: currentColor; box-shadow: inset 0 -3px 4px rgb(0 0 0 / 12%); }
.tone-online { color: var(--rdx-success); background: var(--rdx-success-soft); }
.tone-offline { color: var(--rdx-danger); background: var(--rdx-danger-soft); }
.tone-alarm { color: var(--rdx-warning); background: var(--rdx-warning-soft); }
.map-shell { padding: 12px; overflow: hidden; }
.filters { display: grid; grid-template-columns: minmax(240px, 1.5fr) repeat(2, minmax(170px, .8fr)) auto; align-items: center; gap: 10px; margin-bottom: 12px; }
.filters label { position: relative; min-width: 0; }
.filters input, .filters select { min-height: 40px; border-color: var(--rdx-border); font-size: 12px; }
.search-filter input { padding-left: 40px; }
.search-icon { position: absolute; top: 50%; left: 14px; z-index: 1; transform: translateY(-50%); color: var(--rdx-primary); font-size: 22px; pointer-events: none; }
.results-count { padding: 0 6px; color: var(--rdx-text-muted); font-size: 11px; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.map-content { display: grid; grid-template-columns: minmax(0, 1fr) 270px; gap: 12px; min-width: 0; }
.map-stage { position: relative; min-width: 0; }
.plant-map { width: 100%; height: clamp(500px, 67vh, 720px); border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-md); background: var(--rdx-background); overflow: hidden; }
.map-empty { min-height: 500px; margin: 0; padding: 24px; border-radius: var(--rdx-radius-md); background: var(--rdx-background); color: var(--rdx-text-muted); }
.no-results { position: absolute; top: 12px; left: 50%; z-index: 500; max-width: calc(100% - 32px); margin: 0; padding: 8px 12px; transform: translateX(-50%); border-radius: var(--rdx-radius-sm); background: rgb(255 255 255 / 92%); box-shadow: var(--rdx-shadow-sm); color: var(--rdx-text-muted); font-size: 12px; text-align: center; }
.map-legend { position: absolute; left: 12px; bottom: 12px; z-index: 500; display: flex; flex-wrap: wrap; gap: 12px 18px; max-width: calc(100% - 24px); padding: 9px 13px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: rgb(255 255 255 / 94%); box-shadow: var(--rdx-shadow-sm); }
.map-legend span { display: inline-flex; align-items: center; gap: 7px; color: var(--rdx-text); font-size: 11px; white-space: nowrap; }
.map-legend i, .no-location-panel em i { width: 10px; height: 10px; flex: 0 0 10px; border-radius: 50%; }
.no-location-panel { min-width: 0; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-md); background: var(--rdx-surface); overflow: hidden; }
.no-location-panel > header { padding: 16px; border-bottom: 1px solid var(--rdx-neutral-soft); }
.no-location-panel h2 { margin: 0; color: var(--rdx-text-strong); font-size: 15px; }
.no-location-panel ul { margin: 0; padding: 0 14px; list-style: none; }
.no-location-panel li { border-bottom: 1px solid var(--rdx-neutral-soft); }
.no-location-panel li:last-child { border-bottom: 0; }
.no-location-panel a { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 8px; padding: 14px 0; color: inherit; }
.plant-list-icon { padding-top: 2px; font-size: 20px; }
.no-location-panel a > span:last-child { display: grid; gap: 3px; min-width: 0; }
.no-location-panel strong { color: var(--rdx-text-strong); font-size: 12px; overflow-wrap: anywhere; }
.no-location-panel small { color: var(--rdx-text-muted); font-size: 10px; overflow-wrap: anywhere; }
.no-location-panel em { display: inline-flex; align-items: center; gap: 6px; color: var(--rdx-text); font-size: 10px; font-style: normal; }
.empty-note { margin: 0; padding: 18px 16px; color: var(--rdx-text-muted); font-size: 11px; line-height: 1.5; }
:deep(.plant-status-marker) { filter: drop-shadow(0 2px 3px rgb(0 0 0 / 28%)); }
:deep(.leaflet-control-zoom) { border: 0 !important; box-shadow: var(--rdx-shadow-md) !important; }
:deep(.leaflet-control-zoom a) { color: var(--rdx-text-strong); }
:deep(.leaflet-popup-content-wrapper) { border-radius: 10px; box-shadow: 0 12px 30px rgb(13 49 39 / 20%); }
:deep(.leaflet-popup-content) { margin: 14px; }
:deep(.map-popup) { min-width: 235px; }
:deep(.map-popup-title) { display: block; margin: 0 0 8px; color: var(--rdx-text-strong); font-size: 15px; }
:deep(.map-popup-line) { display: flex; justify-content: space-between; gap: 16px; margin-top: 7px; color: var(--rdx-text-muted); font-size: 11px; }
:deep(.map-popup-line strong) { color: var(--rdx-text-strong); font-weight: 650; text-align: right; }
:deep(.map-popup-link) { display: block; margin-top: 11px; padding: 8px 12px; border-radius: 6px; background: var(--rdx-primary); color: #fff; font-size: 11px; font-weight: 700; text-align: center; text-decoration: none; }
@media (max-width: 1199px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filters { grid-template-columns: minmax(220px, 1.4fr) repeat(2, minmax(150px, 1fr)); }
  .results-count { grid-column: 1 / -1; }
}
@media (max-width: 899px) {
  .map-content { grid-template-columns: 1fr; }
  .no-location-panel { max-height: 280px; overflow-y: auto; }
  .plant-map { height: clamp(460px, 62vh, 620px); }
}
@media (max-width: 767px) {
  .map-header { align-items: flex-start; flex-direction: column; gap: 6px; }
  .map-header h1 { font-size: 27px; }
  .last-update { padding: 0; }
  .filters { grid-template-columns: 1fr; }
  .summary-card { min-height: 82px; padding: 13px; }
  .summary-icon { width: 40px; height: 40px; flex-basis: 40px; }
  .map-legend { gap: 8px 12px; }
}
@media (max-width: 479px) {
  .summary-grid { grid-template-columns: 1fr; gap: 9px; }
  .map-shell { padding: 9px; }
  .plant-map { height: 500px; min-height: 500px; }
  .map-legend { right: 8px; bottom: 8px; left: 8px; max-width: none; }
  :deep(.map-popup) { min-width: 190px; }
}
</style>
