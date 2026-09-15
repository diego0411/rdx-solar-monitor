<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { apiFetch } from '../services/api.js';

L.Icon.Default.prototype._getIconUrl = L.Icon.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const router = useRouter();
const mapElement = ref(null);
const loading = ref(true);
const error = ref('');
const mappedPlants = ref([]);
const controller = new AbortController();
const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };
const statuses = { online: 'En línea', offline: 'Sin conexión', alarm: 'Alarma', inactive: 'Inactiva', unknown: 'Desconocido' };
const capacityFormatter = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 });
let map = null;

function coordinate(value, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function popupFor(plant) {
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = plant.name ?? 'Planta sin nombre';
  content.append(title);

  for (const [label, value] of [
    ['Proveedor', providerNames[plant.provider] ?? plant.provider ?? 'Desconocido'],
    ['Estado', statuses[plant.status] ?? statuses.unknown],
    ['Capacidad', plant.capacity_kwp == null || !Number.isFinite(Number(plant.capacity_kwp))
      ? 'Sin datos' : `${capacityFormatter.format(Number(plant.capacity_kwp))} kWp`],
  ]) {
    const line = document.createElement('div');
    line.textContent = `${label}: ${value}`;
    content.append(line);
  }

  const link = document.createElement('a');
  link.href = router.resolve({ name: 'plant-detail', params: { id: plant.id } }).href;
  link.textContent = 'Ver detalle de planta';
  link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void router.push({ name: 'plant-detail', params: { id: plant.id } });
  });
  content.append(link);
  return content;
}

onMounted(async () => {
  try {
    const plants = await apiFetch('/plants', { signal: controller.signal });
    if (!Array.isArray(plants)) throw new Error('Respuesta inválida');
    mappedPlants.value = plants.map(plant => ({
      ...plant,
      latitude: coordinate(plant.latitude, -90, 90),
      longitude: coordinate(plant.longitude, -180, 180),
    })).filter(plant => plant.latitude !== null && plant.longitude !== null);
  } catch {
    if (!controller.signal.aborted) error.value = 'No se pudieron cargar las plantas del mapa.';
  } finally {
    loading.value = false;
  }

  if (controller.signal.aborted || error.value || !mappedPlants.value.length) return;
  await nextTick();
  if (controller.signal.aborted || !mapElement.value) return;

  map = L.map(mapElement.value);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const bounds = [];
  for (const plant of mappedPlants.value) {
    const position = [plant.latitude, plant.longitude];
    L.marker(position).addTo(map).bindPopup(popupFor(plant));
    bounds.push(position);
  }
  if (bounds.length === 1) map.setView(bounds[0], 12);
  else map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
});

onUnmounted(() => {
  controller.abort();
  map?.remove();
  map = null;
});
</script>

<template>
  <header class="page-header">
    <p class="eyebrow">Monitoreo</p>
    <h1>Mapa de plantas</h1>
    <p>Ubicación de las plantas con coordenadas registradas.</p>
  </header>
  <p v-if="loading" class="card" role="status">Cargando mapa…</p>
  <p v-else-if="error" class="card" role="alert">{{ error }}</p>
  <p v-else-if="!mappedPlants.length" class="card">No hay plantas con coordenadas válidas.</p>
  <template v-else>
    <p role="status">{{ mappedPlants.length }} plantas en el mapa</p>
    <div ref="mapElement" class="plant-map" aria-label="Mapa de plantas" />
  </template>
</template>

<style scoped>
.plant-map { width: 100%; height: min(70vh, 680px); min-height: 400px; border: 1px solid #dfe7e1; border-radius: 14px; }
</style>
