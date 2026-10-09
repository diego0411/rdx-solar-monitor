<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getAlarm, getAlarmSummary, listAlarms } from '../services/alarms.js';
import { getPlantsCatalog } from '../services/catalog.js';
import { useModalEscape } from '../composables/useModalStack.js';

const PAGE_SIZE = 10;

const statusLabels = {
  active: 'Activa',
  resolved: 'Resuelta',
};

const severityLabels = {
  critical: 'Crítica',
  warning: 'Advertencia',
  information: 'Información',
};

const providerLabels = {
  growatt: 'Growatt',
  hyxi: 'HYXiPOWER',
};

const technicalFields = [
  'status',
  'statusText',
  'faultType',
  'warnCode',
  'newWarnCode',
  'errorText',
  'warnText',
];

const alarms = ref([]);
const pagination = ref({ page: 1, page_size: PAGE_SIZE, total: 0, total_pages: 0 });
const summary = ref({ active: 0, critical: 0, warning: 0, resolved_7d: 0 });
const plants = ref([]);
const plantNames = ref({});

const loading = ref(true);
const tableLoading = ref(false);
const error = ref('');
const summaryError = ref('');

const statusFilter = ref('all');
const severityFilter = ref('all');
const providerFilter = ref('all');
const plantFilter = ref('all');
const search = ref('');

const detail = ref(null);
const showDetail = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
const technicalOpen = ref(false);

const controller = new AbortController();

function statusLabel(status) {
  return statusLabels[status] ?? status ?? 'Sin datos';
}

function severityLabel(severity) {
  if (severity === null || severity === undefined || severity === '') return 'Sin clasificación';
  return severityLabels[severity] ?? severity;
}

function providerLabel(provider) {
  return providerLabels[provider] ?? provider ?? 'Sin datos';
}

function isRdxClassified(alarm) {
  return alarm?.provider === 'growatt' && alarm?.severity !== null && alarm?.severity !== undefined;
}

function formatDate(value) {
  if (!value) return 'Sin datos';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin datos';
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function plantName(alarm) {
  return alarm?.plant?.name ?? plantNames.value[alarm?.plant?.id] ?? 'Sin datos';
}

function deviceName(alarm) {
  return alarm?.device?.name ?? 'Sin planta';
}

function deviceSerial(alarm) {
  return alarm?.device?.serial_number ?? null;
}

const plantOptions = computed(() => plants.value.map(plant => ({
  id: plant.id,
  name: plant.name ?? plant.id,
})));

const hasActiveFilters = computed(() => (
  statusFilter.value !== 'all'
  || severityFilter.value !== 'all'
  || providerFilter.value !== 'all'
  || plantFilter.value !== 'all'
  || search.value.trim() !== ''
));

// El backend no filtra severity NULL: "Sin clasificación" se aplica sobre
// la página recibida (limitación documentada del contrato actual).
const visibleAlarms = computed(() => {
  if (severityFilter.value !== 'none') return alarms.value;
  return alarms.value.filter(alarm => alarm.severity === null || alarm.severity === undefined);
});

function buildParams(page) {
  const params = { page, pageSize: PAGE_SIZE };
  if (statusFilter.value !== 'all') params.status = statusFilter.value;
  if (severityFilter.value !== 'all' && severityFilter.value !== 'none') params.severity = severityFilter.value;
  if (providerFilter.value !== 'all') params.provider = providerFilter.value;
  if (plantFilter.value !== 'all') params.plantId = plantFilter.value;
  const term = search.value.trim();
  if (term) params.search = term;
  return params;
}

async function loadAlarms({ resetPage = false } = {}) {
  if (resetPage) pagination.value.page = 1;
  tableLoading.value = true;
  if (alarms.value.length === 0) loading.value = true;
  error.value = '';
  try {
    const data = await listAlarms(buildParams(pagination.value.page), { signal: controller.signal });
    if (!data || !Array.isArray(data.alarms) || !data.pagination) throw new Error('Respuesta inválida');
    alarms.value = data.alarms;
    pagination.value = {
      page: data.pagination.page ?? 1,
      page_size: data.pagination.page_size ?? PAGE_SIZE,
      total: data.pagination.total ?? 0,
      total_pages: data.pagination.total_pages ?? 0,
    };
  } catch (failure) {
    if (!controller.signal.aborted) {
      error.value = 'No se pudieron cargar las alarmas. Comprueba la conexión y vuelve a intentarlo.';
    }
  } finally {
    loading.value = false;
    tableLoading.value = false;
  }
}

async function loadSummary() {
  summaryError.value = '';
  try {
    const data = await getAlarmSummary({ signal: controller.signal });
    if (!data || typeof data !== 'object') throw new Error('Respuesta inválida');
    summary.value = {
      active: data.active ?? 0,
      critical: data.critical ?? 0,
      warning: data.warning ?? 0,
      resolved_7d: data.resolved_7d ?? 0,
    };
  } catch (failure) {
    if (!controller.signal.aborted) {
      summaryError.value = 'No se pudo cargar el resumen.';
    }
  }
}

async function loadPlants() {
  try {
    const data = await getPlantsCatalog({ signal: controller.signal });
    const plantList = Array.isArray(data) ? data : [];
    plants.value = plantList;
    plantNames.value = Object.fromEntries(
      plantList.map(plant => [plant.id, plant.name ?? plant.id]),
    );
  } catch {
    plants.value = [];
    plantNames.value = {};
  }
}

function onFilterChange() {
  void loadAlarms({ resetPage: true });
}

function goToPage(page) {
  if (page < 1 || page > pagination.value.total_pages || page === pagination.value.page) return;
  pagination.value.page = page;
  void loadAlarms();
}

function retry() {
  void loadSummary();
  void loadAlarms();
}

async function openDetail(id) {
  showDetail.value = true;
  detail.value = null;
  detailError.value = '';
  technicalOpen.value = false;
  detailLoading.value = true;
  try {
    const data = await getAlarm(id, { signal: controller.signal });
    if (!data || typeof data !== 'object' || !data.id) throw new Error('Respuesta inválida');
    detail.value = data;
  } catch (failure) {
    if (!controller.signal.aborted) {
      detailError.value = 'No se pudo cargar el detalle de la alarma.';
    }
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  if (detailLoading.value) return;
  showDetail.value = false;
  detail.value = null;
  detailError.value = '';
}

// UX-03C2A: Escape cierra el modal superior; scroll del fondo bloqueado.
useModalEscape(() => showDetail.value, closeDetail);

function toggleTechnical() {
  technicalOpen.value = !technicalOpen.value;
}

function technicalEntries(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return technicalFields
    .filter(field => payload[field] !== undefined && payload[field] !== null && payload[field] !== '')
    .map(field => ({ field, value: payload[field] }));
}

async function load() {
  loading.value = true;
  await loadPlants();
  await Promise.all([loadSummary(), loadAlarms()]);
}

onMounted(load);
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="alarms-page">
    <header class="page-header alarms-header">
      <div>
        <p class="eyebrow">RDX SOLAR MONITOR</p>
        <h1>Alarmas</h1>
        <p class="page-description">
          Monitoreo e historial de alarmas de las plantas y dispositivos.
        </p>
      </div>
    </header>

    <section class="kpi-grid">
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">ACTIVAS</span></div>
        <strong class="kpi-value">{{ summaryError ? '—' : summary.active }}</strong>
        <span class="kpi-state" :class="{ warning: summary.active > 0 }">
          {{ summaryError ? summaryError : 'Episodios activos' }}
        </span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">CRÍTICAS</span></div>
        <strong class="kpi-value">{{ summaryError ? '—' : summary.critical }}</strong>
        <span class="kpi-state" :class="{ warning: summary.critical > 0 }">
          Activas críticas
        </span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">ADVERTENCIAS</span></div>
        <strong class="kpi-value">{{ summaryError ? '—' : summary.warning }}</strong>
        <span class="kpi-state">Activas de advertencia</span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">RESUELTAS (7 DÍAS)</span></div>
        <strong class="kpi-value">{{ summaryError ? '—' : summary.resolved_7d }}</strong>
        <span class="kpi-state">Resueltas últimos 7 días</span>
      </article>
    </section>

    <section class="card filters-card">
      <div class="filters-grid">
        <label class="filter-field">
          <span>Estado</span>
          <select v-model="statusFilter" @change="onFilterChange">
            <option value="all">Todos</option>
            <option value="active">Activa</option>
            <option value="resolved">Resuelta</option>
          </select>
        </label>
        <label class="filter-field">
          <span>Severidad</span>
          <select v-model="severityFilter" @change="onFilterChange">
            <option value="all">Todas</option>
            <option value="critical">Crítica</option>
            <option value="warning">Advertencia</option>
            <option value="information">Información</option>
            <option value="none">Sin clasificación</option>
          </select>
        </label>
        <label class="filter-field">
          <span>Fabricante</span>
          <select v-model="providerFilter" @change="onFilterChange">
            <option value="all">Todos</option>
            <option value="growatt">Growatt</option>
            <option value="hyxi">HYXiPOWER</option>
          </select>
        </label>
        <label class="filter-field">
          <span>Planta</span>
          <select v-model="plantFilter" @change="onFilterChange">
            <option value="all">Todas</option>
            <option v-for="option in plantOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
        </label>
        <label class="filter-field">
          <span>Búsqueda <small class="soon-note">(código, título, descripción)</small></span>
          <input v-model="search" type="search" placeholder="Código, título o descripción" @change="onFilterChange" />
        </label>
      </div>
    </section>

    <section class="card alarms-card">
      <div class="section-header">
        <div>
          <p class="section-eyebrow">EPISODIOS</p>
          <h2>Listado de alarmas</h2>
        </div>
        <span class="visit-count">{{ pagination.total }}</span>
      </div>

      <div v-if="loading" class="empty-state" role="status">
        <div class="empty-icon loading-icon">↻</div>
        <strong>Consultando alarmas</strong>
        <p>Recopilando el historial de episodios.</p>
      </div>

      <div v-else-if="error" class="empty-state" role="alert">
        <div class="empty-icon error-icon">!</div>
        <strong>No se pudo cargar</strong>
        <p>{{ error }}</p>
        <button class="secondary-button retry-button" type="button" @click="retry">Reintentar</button>
      </div>

      <div v-else-if="!visibleAlarms.length" class="empty-state">
        <div class="empty-icon success-icon">✓</div>
        <strong>Sin alarmas</strong>
        <p>{{ hasActiveFilters ? 'No se registraron alarmas con los filtros seleccionados.' : 'No se registraron alarmas todavía.' }}</p>
      </div>

      <div v-else class="table-wrapper">
        <table class="alarm-table">
          <thead>
            <tr>
              <th>Estado</th>
              <th>Severidad</th>
              <th>Alarma</th>
              <th>Planta</th>
              <th>Dispositivo</th>
              <th>Fabricante</th>
              <th>Detectada</th>
              <th>Última detección</th>
              <th>Resolución</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="alarm in visibleAlarms" :key="alarm.id">
              <td>
                <span class="status-badge" :class="alarm.status">{{ statusLabel(alarm.status) }}</span>
              </td>
              <td>
                <span class="status-badge" :class="`sev-${alarm.severity ?? 'none'}`">{{ severityLabel(alarm.severity) }}</span>
              </td>
              <td>
                <strong class="alarm-title">{{ alarm.title }}</strong>
                <small class="alarm-code">{{ alarm.alarm_code }}</small>
              </td>
              <td class="plant-name">{{ plantName(alarm) }}</td>
              <td>
                {{ deviceName(alarm) }}
                <small v-if="deviceSerial(alarm)" class="alarm-code">{{ deviceSerial(alarm) }}</small>
              </td>
              <td>{{ providerLabel(alarm.provider) }}</td>
              <td class="date-cell">{{ formatDate(alarm.first_seen_at) }}</td>
              <td class="date-cell">{{ formatDate(alarm.last_seen_at) }}</td>
              <td class="date-cell">{{ alarm.status === 'resolved' ? formatDate(alarm.resolved_at) : '—' }}</td>
              <td>
                <button class="detail-link link-button" type="button" @click="openDetail(alarm.id)">Ver detalle</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!loading && !error && pagination.total_pages > 1" class="pagination">
        <button class="secondary-button" type="button" :disabled="pagination.page <= 1 || tableLoading" @click="goToPage(pagination.page - 1)">Anterior</button>
        <span class="pagination-label">Página {{ pagination.page }} de {{ pagination.total_pages }}</span>
        <button class="secondary-button" type="button" :disabled="pagination.page >= pagination.total_pages || tableLoading" @click="goToPage(pagination.page + 1)">Siguiente</button>
      </div>
    </section>

    <div v-if="showDetail" class="modal-backdrop" @click.self="closeDetail">
      <section class="card modal" role="dialog" aria-modal="true" aria-label="Detalle de alarma">
        <h2>Detalle de alarma</h2>

        <div v-if="detailLoading" class="empty-state" role="status">
          <div class="empty-icon loading-icon">↻</div>
          <strong>Cargando detalle</strong>
        </div>

        <div v-else-if="detailError" class="empty-state" role="alert">
          <div class="empty-icon error-icon">!</div>
          <strong>No se pudo cargar el detalle</strong>
          <p>{{ detailError }}</p>
        </div>

        <div v-else-if="detail" class="detail-grid">
          <dl>
            <div><dt>Estado</dt><dd><span class="status-badge" :class="detail.status">{{ statusLabel(detail.status) }}</span></dd></div>
            <div>
              <dt>Severidad</dt>
              <dd>
                <span class="status-badge" :class="`sev-${detail.severity ?? 'none'}`">{{ severityLabel(detail.severity) }}</span>
                <small v-if="isRdxClassified(detail)" class="rdx-note">Clasificación RDX</small>
              </dd>
            </div>
            <div><dt>Fabricante</dt><dd>{{ providerLabel(detail.provider) }}</dd></div>
            <div><dt>Código</dt><dd><span class="alarm-code">{{ detail.alarm_code }}</span></dd></div>
            <div><dt>Título</dt><dd>{{ detail.title }}</dd></div>
            <div><dt>Descripción</dt><dd>{{ detail.description ?? 'Sin datos' }}</dd></div>
            <div><dt>Planta</dt><dd>{{ plantName(detail) }}</dd></div>
            <div><dt>Dispositivo</dt><dd>{{ deviceName(detail) }}</dd></div>
            <div><dt>Número de serie</dt><dd>{{ deviceSerial(detail) ?? 'Sin datos' }}</dd></div>
            <div><dt>Tipo de dispositivo</dt><dd>{{ detail.device?.device_type ?? 'Sin datos' }}</dd></div>
            <div><dt>Inicio fabricante</dt><dd>{{ detail.started_at ? formatDate(detail.started_at) : 'No informado por el fabricante' }}</dd></div>
            <div><dt>Primera detección RDX</dt><dd>{{ formatDate(detail.first_seen_at) }}</dd></div>
            <div><dt>Última detección</dt><dd>{{ formatDate(detail.last_seen_at) }}</dd></div>
            <div><dt>Resolución</dt><dd>{{ detail.status === 'resolved' ? formatDate(detail.resolved_at) : '—' }}</dd></div>
          </dl>

          <section class="technical-section">
            <button class="secondary-button" type="button" @click="toggleTechnical">
              {{ technicalOpen ? 'Ocultar información técnica' : 'Información técnica' }}
            </button>
            <div v-if="technicalOpen">
              <dl v-if="technicalEntries(detail.raw_payload).length" class="technical-list">
                <div v-for="entry in technicalEntries(detail.raw_payload)" :key="entry.field">
                  <dt>{{ entry.field }}</dt>
                  <dd>{{ String(entry.value) }}</dd>
                </div>
              </dl>
              <p v-else class="technical-empty">Sin datos técnicos disponibles.</p>
            </div>
          </section>
        </div>

        <div class="modal-actions">
          <button class="secondary-button" type="button" @click="closeDetail">Cerrar</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.alarms-page {
  width: 100%;
  min-width: 0;
}

.alarms-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 24px;
}

.page-description {
  margin-top: 6px;
  color: var(--rdx-text-muted);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  margin-bottom: 18px;
}

.kpi-card {
  min-width: 0;
  padding: 22px;
}

.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.kpi-label,
.section-eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--rdx-text-muted);
}

.kpi-value {
  display: block;
  margin: 13px 0 8px;
  font-size: 34px;
  line-height: 1;
  color: var(--rdx-text-strong);
}

.kpi-state {
  font-size: 13px;
  color: var(--rdx-success);
}

.kpi-state.warning {
  color: var(--rdx-warning);
}

.filters-card {
  padding: 18px 22px;
  margin-bottom: 18px;
}

.filters-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--rdx-text-muted);
}

.filter-field select,
.filter-field input {
  padding: 9px 12px;
  border: 1px solid var(--rdx-border);
  border-radius: 9px;
  background: var(--rdx-surface);
  color: var(--rdx-text-strong);
  font-size: 13px;
}

.soon-note {
  font-weight: 400;
}

.alarms-card {
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 22px;
  border-bottom: 1px solid var(--rdx-border);
}

.section-header h2 {
  margin: 4px 0 0;
  font-size: 18px;
}

.visit-count {
  display: grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.empty-state {
  display: flex;
  min-height: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 35px 20px;
  text-align: center;
}

.alarms-card .empty-state {
  min-height: 190px;
  padding: 28px 20px;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 13px;
  border-radius: 50%;
  font-size: 22px;
  font-weight: 700;
}

.success-icon {
  background: var(--rdx-success-soft);
  color: var(--rdx-success);
}

.loading-icon {
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
}

.error-icon {
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
}

.empty-state strong {
  color: var(--rdx-text-strong);
  font-size: 15px;
}

.empty-state p {
  margin: 6px 0 0;
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.retry-button {
  margin-top: 14px;
}

.table-wrapper {
  width: 100%;
  overflow-x: auto;
}

.alarm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.alarm-table th {
  padding: 12px 16px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: left;
  white-space: nowrap;
}

.alarm-table td {
  padding: 15px 16px;
  border-top: 1px solid var(--rdx-border);
  color: var(--rdx-text-muted);
  vertical-align: middle;
}

.plant-name {
  color: var(--rdx-text-strong) !important;
  font-weight: 600;
}

.status-badge {
  display: inline-flex;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.status-badge.active {
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
}

.status-badge.resolved {
  background: var(--rdx-success-soft);
  color: var(--rdx-success);
}

.status-badge.sev-critical {
  background: var(--rdx-danger-soft);
  color: var(--rdx-danger);
}

.status-badge.sev-warning {
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
}

.status-badge.sev-information {
  background: var(--rdx-primary-soft);
  color: var(--rdx-accent);
}

.status-badge.sev-none {
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
}

.alarm-title {
  display: block;
  color: var(--rdx-text-strong);
}

.alarm-code {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--rdx-text-faint, var(--rdx-text-muted));
}

.date-cell {
  white-space: nowrap;
}

.detail-link {
  color: var(--rdx-accent);
  font-weight: 700;
  white-space: nowrap;
}

.link-button {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
}

.secondary-button {
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid var(--rdx-border);
  background: var(--rdx-surface);
  color: var(--rdx-text-strong);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.secondary-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 16px 22px;
  border-top: 1px solid var(--rdx-border);
}

.pagination-label {
  font-size: 13px;
  color: var(--rdx-text-muted);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(0 0 0 / 0.45);
  z-index: 50;
}

.modal {
  width: 100%;
  max-width: 560px;
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
}

.modal h2 {
  margin: 0 0 12px;
  font-size: 18px;
}

.detail-grid dl {
  display: grid;
  gap: 10px;
  margin: 0 0 16px;
  padding: 0;
}

.detail-grid dl > div {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
}

.detail-grid dt {
  font-size: 12px;
  font-weight: 700;
  color: var(--rdx-text-muted);
}

.detail-grid dd {
  margin: 0;
  font-size: 13px;
  color: var(--rdx-text-strong);
  overflow-wrap: anywhere;
}

.rdx-note {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.technical-section {
  margin-bottom: 16px;
}

.technical-list {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding: 12px 14px;
  border: 1px solid var(--rdx-border);
  border-radius: 8px;
  background: var(--rdx-neutral-soft);
}

.technical-list > div {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 10px;
  font-size: 13px;
}

.technical-list dt {
  font-weight: 700;
  color: var(--rdx-text-muted);
}

.technical-list dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.technical-empty {
  margin-top: 10px;
  font-size: 13px;
  color: var(--rdx-text-muted);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filters-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .kpi-grid,
  .filters-grid {
    grid-template-columns: 1fr;
  }

  .section-header {
    padding: 17px 18px;
  }

  .detail-grid dl > div {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
