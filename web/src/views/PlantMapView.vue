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
const dataStatus = ref('');

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
  offline: [rdxColor('--rdx-neutral-soft'), rdxColor('--rdx-text-muted')],
  alarm: [rdxColor('--rdx-danger-soft'), rdxColor('--rdx-danger')],
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
  alarm: rdxColor('--rdx-danger'),
  offline: rdxColor('--rdx-neutral'),
  inactive: '#a4ada9',
  unknown: '#a4ada9',
};

const number = new Intl.NumberFormat('es-BO', {
  maximumFractionDigits: 2,
});

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
  div.textContent = `${label}: ${value}`;
  div.style.margin = '5px 0 0';
  div.style.fontSize = '12px';
  div.style.color = rdxColor('--rdx-text-muted');
  return div;
}

function popupFor(plant) {
  const content = document.createElement('div');
  content.style.minWidth = '200px';

  const title = document.createElement('strong');
  title.textContent = plant.name ?? 'Planta sin nombre';
  title.style.display = 'block';
  title.style.margin = '0 0 6px';
  title.style.fontSize = '14px';
  title.style.color = rdxColor('--rdx-text');
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
  link.textContent = 'Ver planta →';
  link.style.display = 'inline-block';
  link.style.marginTop = '8px';
  link.style.color = rdxColor('--rdx-accent');
  link.style.fontSize = '12px';
  link.style.fontWeight = '600';
  link.style.textDecoration = 'none';
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

const plantsWithCoords = computed(() =>
  plants.value.filter(hasCoords));

const plantsWithoutCoords = computed(() =>
  plants.value.filter(plant => !hasCoords(plant)));

const noCoordText = computed(() => {
  const names = plantsWithoutCoords.value
    .map(plant => plant.name)
    .filter(Boolean);
  if (!names.length) return '';
  return `${names.length} planta${names.length > 1 ? 's' : ''} sin coordenadas: ${names.join(', ')}`;
});

const filteredPlants = computed(() => {
  const term = normalize(search.value.trim());
  return plantsWithCoords.value.filter(plant =>
    (!term || normalize(plant.name).includes(term))
    && (!provider.value || plant.provider === provider.value)
    && (!status.value || plant.status === status.value)
    && (!dataStatus.value || plant.data_status === dataStatus.value));
});

function renderMarkers() {
  if (!map) return;

  markerLayer.clearLayers();

  const positions = [];
  for (const plant of filteredPlants.value) {
    const position = [plant.latitude, plant.longitude];
    const marker = L.circleMarker(position, {
      radius: 7,
      color: '#ffffff',
      weight: 1.5,
      fillColor: markerColor(plant.status),
      fillOpacity: 0.9,
    });
    marker.bindPopup(popupFor(plant));
    marker.addTo(markerLayer);
    positions.push(position);
  }

  if (positions.length > 1) {
    map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], maxZoom: 12 });
  } else if (positions.length === 1) {
    map.setView(positions[0], 12);
  }
}

onMounted(async () => {
  let stored = null;
  let overview = [];

  try {
    const data = await apiFetch('/plants', { signal: controller.signal });
    stored = Array.isArray(data) ? data : [];
  } catch (failure) {
    if (!controller.signal.aborted) {
      console.error('Mapa: fallo al cargar /plants', failure);
    }
  }

  if (!controller.signal.aborted && stored !== null) {
    try {
      const data = await apiFetch('/plants/overview', { signal: controller.signal });
      overview = Array.isArray(data) ? data : [];
    } catch (failure) {
      if (!controller.signal.aborted) {
        console.error('Mapa: fallo al cargar /plants/overview (modo degradado)', failure);
      }
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

  const overviewById = new Map(overview.map(plant => [plant.id, plant]));
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
  [search, provider, status, dataStatus],
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
  <header class="page-header">
    <p class="eyebrow">
      Monitoreo
    </p>

    <h1>
      Mapa de plantas
    </h1>

    <p>
      Ubicación y monitoreo de las plantas.
    </p>
  </header>

  <p
    v-if="loading"
    class="card"
    role="status"
  >
    Cargando mapa…
  </p>

  <p
    v-else-if="error"
    class="card"
    role="alert"
  >
    {{ error }}
  </p>

  <template v-else>
    <form
      class="filters card"
      aria-label="Filtros del mapa"
      @submit.prevent
    >
      <label>
        Buscar
        <input
          v-model="search"
          type="search"
          placeholder="Nombre de planta"
        />
      </label>

      <label>
        Proveedor
        <select v-model="provider">
          <option value="">
            Todos
          </option>

          <option
            v-for="(label, key) in providerNames"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </label>

      <label>
        Estado
        <select v-model="status">
          <option value="">
            Todos
          </option>

          <option
            v-for="(label, key) in statuses"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </label>

      <label>
        Telemetría
        <select v-model="dataStatus">
          <option value="">
            Todas
          </option>

          <option
            v-for="(label, key) in freshness"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </label>
    </form>

    <p
      class="counter"
      role="status"
    >
      {{ filteredPlants.length }} de
      {{ plants.length }} plantas en el mapa
    </p>

    <p
      v-if="noCoordText"
      class="no-coords"
      role="status"
    >
      {{ noCoordText }}
    </p>

    <p
      v-if="plants.length && plantsWithCoords.length && !filteredPlants.length"
      class="no-results"
      role="status"
    >
      Sin resultados para los filtros.
    </p>

    <p
      v-if="plants.length && !plantsWithCoords.length"
      class="card"
    >
      No hay plantas con coordenadas válidas.
    </p>

    <div
      v-if="plantsWithCoords.length"
      ref="mapElement"
      class="plant-map"
      aria-label="Mapa de plantas"
    />
  </template>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 14px;
  padding: 16px 18px;
  margin-bottom: 16px;
}

.filters label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.counter {
  margin: 0 0 8px;
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.no-coords {
  margin: 0 0 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
  font-size: 13px;
}

.no-results {
  margin: 0 0 8px;
  color: var(--rdx-text-faint);
  font-size: 13px;
}

.plant-map {
  width: 100%;
  height: min(72vh, 680px);
  min-height: 420px;
  border: 1px solid var(--rdx-border);
  border-radius: 14px;
}
</style>