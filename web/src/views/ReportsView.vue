<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getPlantsCatalog } from '../services/catalog.js';

// ECO-04D1: estructura del módulo Reportes. Solo selección de parámetros y
// vista previa vacía: no consulta energía/economía, no genera PDF ni usa
// datos simulados. El acceso lo protege la ruta (módulo 'reports').
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
const requested = ref(false);
const controller = new AbortController();

const periodLabel = computed(() => periods.find(item => item.key === period.value)?.label ?? '');
const typeLabel = computed(() => reportTypes.find(item => item.key === reportType.value)?.label ?? '');
const plantName = computed(() => plants.value.find(item => item.id === plantId.value)?.name ?? '');
const validDate = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(selectedDate.value));
const canGenerate = computed(() => plantId.value !== '' && period.value !== '' && validDate.value && reportType.value !== '');

function requestReport() {
  if (!canGenerate.value) return;
  requested.value = true;
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
onUnmounted(() => controller.abort());
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
          <select v-model="plantId" required>
            <option value="">Selecciona una planta</option>
            <option v-for="plant in plants" :key="plant.id" :value="plant.id">{{ plant.name }}</option>
          </select>
        </label>
        <label>
          <span>Periodo</span>
          <select v-model="period">
            <option v-for="item in periods" :key="item.key" :value="item.key">{{ item.label }}</option>
          </select>
        </label>
        <label>
          <span>Fecha (dentro del periodo)</span>
          <input v-model="selectedDate" type="date" required />
        </label>
        <label>
          <span>Tipo de reporte</span>
          <select v-model="reportType">
            <option v-for="item in reportTypes" :key="item.key" :value="item.key">{{ item.label }}</option>
          </select>
        </label>
        <div class="form-actions">
          <button class="primary-button" type="submit" :disabled="!canGenerate">Generar reporte</button>
        </div>
      </form>

      <section class="card preview" aria-label="Vista previa del reporte" aria-live="polite">
        <template v-if="!requested">
          <h2>Vista previa</h2>
          <p>Selecciona planta, periodo, fecha y tipo de reporte, y pulsa «Generar reporte». Aquí aparecerá la vista previa sin descargar ningún archivo.</p>
        </template>
        <template v-else>
          <h2>Vista previa no disponible todavía</h2>
          <p>Parámetros elegidos: {{ plantName }} · {{ periodLabel }} · {{ selectedDate }} · {{ typeLabel }}.</p>
          <p>La generación de reportes aún no está habilitada; no se ha consultado ningún dato energético ni económico.</p>
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
@media (max-width: 767px) {
  .reports-header h1 { font-size: 28px; }
  .filters { grid-template-columns: 1fr; }
  .form-actions { justify-content: stretch; }
  .form-actions .primary-button { width: 100%; }
}
</style>
