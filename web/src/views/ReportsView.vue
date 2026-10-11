<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { apiFetch } from '../services/api.js';
import { getPlantsCatalog } from '../services/catalog.js';
import PlantEnergyHistory from '../components/PlantEnergyHistory.vue';
import { buildReportIndicators } from '../utils/reportPresentation.js';
import { clearRdxColorCache } from '../utils/rdxTokens.js';

// ECO-04D1: estructura del módulo Reportes. ECO-04D2: vista previa
// energética con datos reales del contrato energy-history (vía el
// componente compartido). ECO-04D3: indicadores confiables del contrato
// economics preparados exclusivamente con buildReportIndicators().
// Sin agregaciones propias, sin null→0, sin interpolación, sin PDF.
// El acceso lo protege la ruta (módulo 'reports').
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
const energyKpiFields = [
  ['generation_kwh', 'Generación'],
  ['consumption_kwh', 'Consumo'],
  ['self_consumption_kwh', 'Autoconsumo*'],
  ['grid_import_kwh', 'Importación de red'],
  ['grid_export_kwh', 'Exportación de red'],
];
const moneyKpiFields = [
  ['production_value', 'Producción'],
  ['self_consumption_savings', 'Ahorro por autoconsumo'],
  ['export_value', 'Valor de exportación'],
  ['estimated_economic_benefit', 'Beneficio económico estimado'],
];
const statusLabels = { normal: 'Normal', provisional: 'Provisional', warning: 'Advertencia', unavailable: 'No disponible' };
const statusClasses = { normal: 'state-online', provisional: '', warning: 'data-stale', unavailable: 'state-offline' };

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
const economicsData = ref(null);
const previewLoading = ref(false);
const previewError = ref('');
const ecoLoading = ref(false);
const ecoError = ref('');
let previewController = null;
let ecoController = null;

const periodLabel = computed(() => periods.find(item => item.key === period.value)?.label ?? '');
const plantName = computed(() => plants.value.find(item => item.id === plantId.value)?.name ?? '');
const validDate = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(selectedDate.value));
const canGenerate = computed(() => plantId.value !== '' && period.value !== '' && validDate.value && reportType.value !== '');

const previewPeriodLabel = computed(() => periods.find(item => item.key === preview.value?.period)?.label ?? '');
const previewTypeLabel = computed(() => reportTypes.find(item => item.key === preview.value?.type)?.label ?? '');
const isEconomicPreview = computed(() => preview.value?.type === 'energy_economics');
const tzVerified = computed(() => preview.value?.timezone !== null && preview.value?.timezone !== undefined);
const report = computed(() => (preview.value && isEconomicPreview.value ? buildReportIndicators(economicsData.value) : null));
// Vista lista para imprimir: foto vigente, sin consultas pendientes,
// gráfico recibido y (en económico) indicadores sin error.
const canPrint = computed(() => preview.value !== null
  && !previewLoading.value && !ecoLoading.value
  && history.value !== null
  && (!isEconomicPreview.value || (economicsData.value !== null && !ecoError.value)));
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
  ecoController?.abort();
  previewController = null;
  ecoController = null;
  preview.value = null;
  history.value = null;
  economicsData.value = null;
  previewError.value = '';
  ecoError.value = '';
  previewLoading.value = false;
  ecoLoading.value = false;
}

async function requestReport() {
  if (!canGenerate.value) return;
  invalidatePreview();
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
  if (reportType.value !== 'energy_economics' || request.signal.aborted) return;
  ecoLoading.value = true;
  const ecoRequest = new AbortController();
  ecoController = ecoRequest;
  try {
    const data = await apiFetch(`/plants/${encodeURIComponent(plantId.value)}/economics?period=${encodeURIComponent(period.value)}&startTime=${encodeURIComponent(selectedDate.value)}`, { signal: ecoRequest.signal });
    if (ecoRequest.signal.aborted) return;
    economicsData.value = data ?? null;
    if (!data || typeof data !== 'object') throw new Error('Respuesta inválida');
  } catch {
    if (!ecoRequest.signal.aborted) {
      economicsData.value = null;
      ecoError.value = 'No se pudieron cargar los indicadores económicos. Comprueba la conexión o selecciona otra fecha.';
    }
  } finally {
    if (!ecoRequest.signal.aborted) ecoLoading.value = false;
  }
}

function onHistoryLoaded(data) {
  history.value = data && typeof data === 'object' ? data : null;
}

// Impresión A4 por diálogo del navegador, solo por acción explícita y con
// foto lista. El lienzo del gráfico conserva la paleta del tema activo: antes
// de imprimir se pasa temporalmente a claro con los mecanismos existentes
// (atributo + evento rdx:theme + invalidación de caché) y se restaura
// después (finally + afterprint como red de seguridad, idempotente).
const PRINT_SETTLE_MS = 350;
let printSnapshot = null;
function restorePrintState() {
  if (!printSnapshot) return;
  const { title, dark } = printSnapshot;
  printSnapshot = null;
  try {
    if (typeof document !== 'undefined') {
      document.title = title;
      if (dark) {
        document.documentElement.setAttribute('data-theme', 'dark');
        clearRdxColorCache();
        window.dispatchEvent(new CustomEvent('rdx:theme', { detail: { theme: 'dark' } }));
      }
    }
  } catch {
    // Restauración no disponible: nada que revertir.
  }
}
function onAfterPrint() {
  restorePrintState();
}
async function handlePrint() {
  if (!canPrint.value) return;
  try {
    if (typeof document !== 'undefined') {
      printSnapshot = {
        title: document.title,
        dark: !!document.documentElement?.hasAttribute?.('data-theme'),
      };
      const stamp = [preview.value?.plantName, previewPeriodLabel.value, preview.value?.date]
        .filter(part => part !== null && part !== undefined && String(part) !== '')
        .join(' ').replace(/\s+/g, ' ').trim();
      if (stamp) document.title = `RDX Reporte ${stamp}`.slice(0, 120);
      if (printSnapshot.dark) {
        document.documentElement.removeAttribute('data-theme');
        clearRdxColorCache();
        window.dispatchEvent(new CustomEvent('rdx:theme', { detail: { theme: 'light' } }));
      }
    }
  } catch {
    // Sin DOM: se intenta imprimir con el estado vigente.
  }
  if (printSnapshot?.dark) await new Promise(resolve => setTimeout(resolve, PRINT_SETTLE_MS));
  try {
    window.print();
  } finally {
    restorePrintState();
  }
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

onMounted(() => {
  loadPlants();
  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('afterprint', onAfterPrint);
    }
  } catch {
    // Sin ventana: no hay red de seguridad que registrar.
  }
});
onUnmounted(() => {
  controller.abort(); previewController?.abort(); ecoController?.abort();
  try {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('afterprint', onAfterPrint);
    }
  } catch {
    // Limpieza no disponible.
  }
  restorePrintState();
});
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
        <template v-else>
          <div class="print-only print-header" aria-hidden="true">
            <p class="print-brand">RDX Technology · RDX Solar Monitor</p>
          </div>
          <h2>Vista previa {{ previewTypeLabel.toLowerCase() }}</h2>
          <p class="preview-meta">Planta {{ preview.plantName }} · Periodo {{ previewPeriodLabel }}<span v-if="history?.start && history?.end"> · Rango {{ history.start }} → {{ history.end }}</span><span v-if="generatedAt"> · Generada {{ generatedAt }}</span></p>
          <div class="preview-actions">
            <button class="secondary-button" type="button" :disabled="!canPrint" @click="handlePrint">Imprimir / Guardar PDF</button>
          </div>
          <p v-if="previewLoading" role="status">Cargando información de la planta…</p>
          <p v-if="previewError" class="preview-warn" role="alert">{{ previewError }}</p>
          <p v-if="preview.timezone === null || preview.timezone === undefined" class="preview-warn" role="alert">Zona horaria de la planta no determinada: este periodo no puede considerarse verificado.</p>
          <p v-if="coverageCounts" class="preview-meta" role="status">
            Intervalos: {{ coverageCounts.total }} · Disponibles: {{ coverageCounts.available }} · Parciales: {{ coverageCounts.partial }} · Sin datos: {{ coverageCounts.none }}
          </p>
          <template v-if="isEconomicPreview">
            <p v-if="ecoLoading" role="status">Cargando indicadores económicos…</p>
            <p v-else-if="ecoError" class="preview-warn" role="alert">{{ ecoError }}</p>
            <template v-else-if="report">
              <h3>Indicadores energéticos</h3>
              <dl class="kpi-grid">
                <div v-for="[field, label] in energyKpiFields" :key="field" class="kpi">
                  <dt>{{ label }}</dt>
                  <dd>{{ report.energy[field]?.text ?? '—' }}</dd>
                  <dd><span class="badge" :class="statusClasses[report.energy[field]?.status] ?? ''">{{ statusLabels[report.energy[field]?.status] ?? '' }}</span></dd>
                  <dd v-if="report.energy[field]?.coverage" class="kpi-coverage">{{ report.energy[field].coverage }}</dd>
                </div>
              </dl>
              <h3>Indicadores monetarios</h3>
              <p v-if="!report.monetaryPublishable.publishable" class="preview-warn" role="alert">
                Totales no publicables: {{ report.monetaryPublishable.reasons.join(', ') }}.
              </p>
              <dl class="kpi-grid">
                <div v-for="[field, label] in moneyKpiFields" :key="field" class="kpi">
                  <dt>{{ label }}</dt>
                  <dd>{{ report.money[field]?.text ?? '—' }}</dd>
                  <dd><span class="badge" :class="statusClasses[report.money[field]?.status] ?? ''">{{ statusLabels[report.money[field]?.status] ?? '' }}</span></dd>
                  <dd v-if="report.money[field]?.coverage" class="kpi-coverage">{{ report.money[field].coverage }}</dd>
                </div>
              </dl>
              <h3>Tarifas y moneda</h3>
              <p class="preview-meta">
                Moneda: {{ report.tariffs.currency ?? 'No determinada' }} ·
                Compra: {{ report.tariffs.purchase_energy_rate.text }} ·
                Exportación: {{ report.tariffs.export_energy_rate.text }} ·
                Compensación: {{ report.tariffs.compensation_type ?? '—' }}
              </p>
              <div v-if="report.credit.mode === 'energy_credit' || report.credit.kwh.raw !== null" class="credit">
                <h3>Crédito energético</h3>
                <p class="preview-meta">Generado: {{ report.credit.kwh.text }}<span v-if="report.credit.value.rule === 'purchase-price'"> · Valorizado a precio de compra (regla vigente)</span><span v-if="report.credit.value.raw !== null"> · Valor: {{ report.credit.value.text }}</span></p>
              </div>
              <h3>Advertencias</h3>
              <ul class="disclaimers">
                <li v-for="notice in report.disclaimers" :key="notice.id">{{ notice.text }}</li>
              </ul>
            </template>
          </template>
          <PlantEnergyHistory
            v-model:period="chartPeriod"
            v-model:selected-date="chartDate"
            :plant-id="preview.plantId"
            :timezone="preview.timezone"
            @history-loaded="onHistoryLoaded"
          />
          <div class="print-only print-footer" aria-hidden="true">
            <p>RDX Solar Monitor<span v-if="generatedAt"> · Emitido {{ generatedAt }}</span></p>
          </div>
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
.preview h3 { margin: 18px 0 8px; font-size: 15px; }
.preview p { margin: 6px 0 0; color: var(--rdx-text-muted); font-size: 13px; }
.preview-meta { font-size: 12px; }
.preview-warn { color: var(--rdx-warning); font-weight: 600; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 10px 0 0; padding: 0; }
.kpi { display: grid; gap: 4px; min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: var(--rdx-background); }
.kpi dt { color: var(--rdx-text-muted); font-size: 11px; font-weight: 600; }
.kpi dd { margin: 0; color: var(--rdx-text-strong); font-size: 14px; font-weight: 700; overflow-wrap: anywhere; }
.kpi-coverage { font-size: 11px !important; font-weight: 400 !important; color: var(--rdx-text-muted) !important; }
.disclaimers { margin: 8px 0 0; padding-left: 20px; color: var(--rdx-text-muted); font-size: 12px; display: grid; gap: 4px; }
.credit { margin-top: 4px; }
.print-only { display: none; }
/* El gráfico reutilizado aporta sus propios controles; en la vista previa
   mandan los selectores del reporte. */
.preview :deep(.period-controls) { display: none; }
@media print {
  .reports-header, .filters, .preview-actions { display: none !important; }
  .preview { border: 0; box-shadow: none; padding: 0; }
  .print-only { display: block; }
  .print-header { margin: 0 0 10px; padding-bottom: 8px; border-bottom: 2px solid #174d3c; }
  .print-brand { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #174d3c; }
  .print-footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #dfe7e1; }
  .print-footer p { font-size: 10px; color: #5b6d63; }
  .preview h3 { break-after: avoid; }
  .kpi, .credit, .disclaimers, .preview :deep(.energy-chart) { break-inside: avoid; }
  /* ECO-04D7: el avoid del lienzo no basta; la tarjeta .energy-section
     (título + gráfico) debe ser atómica para que el salto ocurra antes del
     bloque completo (~420px, siempre cabe en una página A4 fresca). */
  .preview :deep(.energy-section) { break-inside: avoid; }
}
@media (max-width: 767px) {
  .reports-header h1 { font-size: 28px; }
  .filters { grid-template-columns: 1fr; }
  .form-actions { justify-content: stretch; }
  .form-actions .primary-button { width: 100%; }
  .preview { padding: 16px; }
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
