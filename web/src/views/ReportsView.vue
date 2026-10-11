<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { apiFetch } from '../services/api.js';
import { getPlantsCatalog } from '../services/catalog.js';
import PlantEnergyHistory from '../components/PlantEnergyHistory.vue';

// ECO-04D1: estructura del módulo Reportes. ECO-04D2: vista previa
// energética con datos reales del contrato energy-history (vía el
// componente compartido). Sin agregaciones propias, sin null→0, sin
// interpolación, sin PDF. El acceso lo protege la ruta (módulo 'reports').
const periods = [
  { key: 'day', label: 'Día' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'year', label: 'Año' },
];
const reportTypes = [
  { key: 'energy', label: 'Energético' },
  { key: 'energy_economics', label: 'Energético + económico' },
];

const plants = ref([]);
const loading = ref(true);
const error = ref('');
const plantId = ref('');
const period = ref('month');
const selectedDate = ref(new Date().toISOString().slice(0, 10));
const reportType = ref('energy');
const controller = new AbortController();

// Foto de la selección generada: los filtros pueden cambiar después sin
// alterar la vista previa hasta pulsar de nuevo «Generar reporte». Los
// filtros editados invalidan explícitamente la foto anterior.
const preview = ref(null);
const chartPeriod = ref('month');
const chartDate = ref('');
const history = ref(null);
const previewLoading = ref(false);
const previewError = ref('');
let previewController = null;

const periodLabel = computed(() => periods.find(item => item.key === period.value)?.label ?? '');
const typeLabel = computed(() => reportTypes.find(item => item.key === reportType.value)?.label ?? '');
const plantName = computed(() => plants.value.find(item => item.id === plantId.value)?.name ?? '');
const validDate = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(selectedDate.value));
const canGenerate = computed(() => plantId.value !== '' && period.value !== '' && validDate.value && reportType.value !== '');

const previewPeriodLabel = computed(() => periods.find(item => item.key === preview.value?.period)?.label ?? '');
const previewTypeLabel = computed(() => reportTypes.find(item => item.key === preview.value?.type)?.label ?? '');
const generatedAt = computed(() => {
  if (!preview.value?.generatedAt) return '';
  const parsed = new Date(preview.value.generatedAt);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(parsed) : '';
});
// Conteo de cobertura por bucket (presentación, sin sumar energía).
const coverageCounts = computed(() => {
  const buckets = Array.isArray(history.value?.buckets) ? history.value.buckets : null;
  if (!buckets) return null;
  const counts = { total: buckets.length, available: 0, partial: 0, none: 0 };
  for (const bucket of buckets) {
    if (bucket?.coverage === 'available') counts.available += 1;
    else if (bucket?.coverage === 'partial') counts.partial += 1;
    else counts.none += 1;
  }
  return counts;
});

function invalidatePreview() {
  previewController?.abort();
  previewController = null;
  preview.value = null;
  history.value = null;
  previewError.value = '';
  previewLoading.value = false;
}

async function requestReport() {
  if (!canGenerate.value) return;
  invalidatePreview();
  if (reportType.value !== 'energy') return;
  preview.value = {
    plantId: plantId.value,
    plantName: plantName.value,
    period: period.value,
    date: selectedDate.value,
    type: reportType.value,
    generatedAt: new Date().toISOString(),
    timezone: null,
  };
  chartPeriod.value = period.value;
  chartDate.value = selectedDate.value;
  previewLoading.value = true;
  const request = new AbortController();
  previewController = request;
  try {
    const data = await apiFetch(`/plants/${encodeURIComponent(plantId.value)}/overview`, { signal: request.signal });
    if (request.signal.aborted) return;
    if (!data?.plant) throw new Error('Respuesta inválida');
    preview.value = { ...preview.value, plantName: data.plant.name ?? preview.value.plantName, timezone: data.plant.timezone ?? null };
  } catch {
    if (!request.signal.aborted) previewError.value = 'No se pudo cargar la información de la planta. El gráfico puede mostrar etiquetas horarias en zona por defecto.';
  } finally {
    if (!request.signal.aborted) previewLoading.value = false;
  }
}

function onHistoryLoaded(data) {
  history.value = data && typeof data === 'object' ? data : null;
}

async function loadPlants() {
  loading.value = true;
  error.value = '';
  try {
    plants.value = await getPlantsCatalog({ signal: controller.signal });
  } catch {
    if (!controller.signal.aborted) error.value = 'No se pudieron cargar las plantas. Comprueba la conexión y vuelve a intentarlo.';
  } finally {
    loading.value = false;
  }
}

onMounted(loadPlants);
onUnmounted(() => { controller.abort(); previewController?.abort(); });
</script>

<template>
  <div class="reports-view">
    <header class="reports-header">
      <div>
        <h1>Reportes</h1>
        <p>Configura los parámetros del reporte. La vista previa mostrará aquí los resultados.</p>
      </div>
    </header>

    <div v-if="loading" class="card page-state" role="status">Cargando plantas…</div>
    <div v-else-if="error" class="card page-state error-state" role="alert">{{ error }}</div>
    <template v-else>
      <form class="filters card" aria-label="Parámetros del reporte" @submit.prevent="requestReport">
        <label>
          <span>Planta</span>
          <select v-model="plantId" required @change="invalidatePreview">
            <option value="">Selecciona una planta</option>
            <option v-for="plant in plants" :key="plant.id" :value="plant.id">{{ plant.name }}</option>
          </select>
        </label>
        <label>
          <span>Periodo</span>
          <select v-model="period" @change="invalidatePreview">
            <option v-for="item in periods" :key="item.key" :value="item.key">{{ item.label }}</option>
          </select>
        </label>
        <label>
          <span>Fecha (dentro del periodo)</span>
          <input v-model="selectedDate" type="date" required @change="invalidatePreview" />
        </label>
        <label>
          <span>Tipo de reporte</span>
          <select v-model="reportType" @change="invalidatePreview">
            <option v-for="item in reportTypes" :key="item.key" :value="item.key">{{ item.label }}</option>
          </select>
        </label>
        <div class="form-actions">
          <button class="primary-button" type="submit" :disabled="!canGenerate">Generar reporte</button>
        </div>
      </form>

      <section class="card preview" aria-label="Vista previa del reporte" aria-live="polite">
        <template v-if="!preview">
          <h2>Vista previa</h2>
          <p>Selecciona planta, periodo, fecha y tipo de reporte, y pulsa «Generar reporte». Aquí aparecerá la vista previa sin descargar ningún archivo.</p>
        </template>
        <template v-else-if="preview.type === 'energy_economics'">
          <h2>Vista previa no disponible todavía</h2>
          <p>Parámetros elegidos: {{ preview.plantName }} · {{ previewPeriodLabel }} · {{ preview.date }} · {{ previewTypeLabel }}.</p>
          <p>La generación de reportes aún no está habilitada; no se ha consultado ningún dato energético ni económico.</p>
        </template>
        <template v-else>
          <h2>Vista previa energética</h2>
          <p class="preview-meta">Planta {{ preview.plantName }} · Periodo {{ previewPeriodLabel }}<span v-if="history?.start && history?.end"> · Rango {{ history.start }} → {{ history.end }}</span><span v-if="generatedAt"> · Generada {{ generatedAt }}</span></p>
          <p v-if="previewLoading" role="status">Cargando información de la planta…</p>
          <p v-if="previewError" class="preview-warn" role="alert">{{ previewError }}</p>
          <p v-if="coverageCounts" class="preview-meta" role="status">
            Intervalos: {{ coverageCounts.total }} · Disponibles: {{ coverageCounts.available }} · Parciales: {{ coverageCounts.partial }} · Sin datos: {{ coverageCounts.none }}
          </p>
          <PlantEnergyHistory
            v-model:period="chartPeriod"
            v-model:selected-date="chartDate"
            :plant-id="preview.plantId"
            :timezone="preview.timezone"
            @history-loaded="onHistoryLoaded"
          />
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.reports-view { width: 100%; }
.reports-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.reports-header h1 { font-size: 31px; }
.reports-header > div > p { margin: 3px 0 0; font-size: 15px; color: var(--rdx-text-muted); }
.page-state { padding: 24px; color: var(--rdx-text-muted); }
.error-state { border-color: var(--rdx-danger-soft); }
.filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 16px; margin-bottom: 16px; border-radius: var(--rdx-radius-md); }
.filters label { display: grid; gap: 6px; min-width: 0; color: var(--rdx-text-muted); font-size: 12px; font-weight: 600; }
.filters input, .filters select { min-height: 40px; font-size: 13px; }
.form-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; }
.preview { padding: 24px; }
.preview h2 { margin: 0 0 8px; font-size: 18px; }
.preview p { margin: 6px 0 0; color: var(--rdx-text-muted); font-size: 13px; }
.preview-meta { font-size: 12px; }
.preview-warn { color: var(--rdx-warning); font-weight: 600; }
/* El gráfico reutilizado aporta sus propios controles; en la vista previa
   mandan los selectores del reporte. */
.preview :deep(.period-controls) { display: none; }
@media (max-width: 767px) {
  .reports-header h1 { font-size: 28px; }
  .filters { grid-template-columns: 1fr; }
  .form-actions { justify-content: stretch; }
  .form-actions .primary-button { width: 100%; }
  .preview { padding: 16px; }
}
</style>
