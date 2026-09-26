<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { apiFetch, getMyProfile } from '../services/api.js';
import { createMaintenanceVisit, listMaintenanceVisits } from '../services/maintenance.js';

const statusLabels = {
  scheduled: 'Programado',
  in_progress: 'En progreso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

const priorityLabels = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

const activityTypeLabels = {
  inspection: 'Inspección',
  preventive: 'Preventivo',
  corrective: 'Correctivo',
  cleaning: 'Limpieza',
  other: 'Otro',
};

const visits = ref([]);
const plants = ref([]);
const plantNames = ref({});
const loading = ref(true);
const error = ref('');
const myRole = ref(null);

const plantFilter = ref('all');
const statusFilter = ref('all');
const dateFrom = ref('');
const dateTo = ref('');

const controller = new AbortController();

const showForm = ref(false);
const formSaving = ref(false);
const formError = ref('');

function emptyForm() {
  return {
    plant_id: '',
    title: '',
    description: '',
    priority: 'normal',
    scheduled_at: '',
    technician_name: '',
    general_observations: '',
    service_amount: '',
    currency: 'BOB',
    next_maintenance_at: '',
    next_maintenance_notes: '',
  };
}

const form = ref(emptyForm());

function openCreate() {
  form.value = emptyForm();
  formError.value = '';
  formSaving.value = false;
  showForm.value = true;
}

function closeForm() {
  if (formSaving.value) return;
  showForm.value = false;
  formError.value = '';
}

function toApiDateTime(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function buildPayload() {
  const title = form.value.title.trim();
  if (!form.value.plant_id) return { error: 'Selecciona una planta.' };
  if (!title) return { error: 'El título es obligatorio.' };
  let serviceAmount = null;
  if (String(form.value.service_amount ?? '').trim() !== '') {
    serviceAmount = Number(form.value.service_amount);
    if (!Number.isFinite(serviceAmount) || serviceAmount < 0) {
      return { error: 'El monto debe ser mayor o igual a 0.' };
    }
  }
  const currency = form.value.currency.trim() || 'BOB';
  const payload = {
    plant_id: form.value.plant_id,
    title,
    priority: form.value.priority || 'normal',
    currency,
  };
  const description = form.value.description.trim();
  if (description) payload.description = description;
  const scheduledAt = toApiDateTime(form.value.scheduled_at);
  if (scheduledAt) payload.scheduled_at = scheduledAt;
  const technician = form.value.technician_name.trim();
  if (technician) payload.technician_name = technician;
  const observations = form.value.general_observations.trim();
  if (observations) payload.general_observations = observations;
  if (serviceAmount !== null) payload.service_amount = serviceAmount;
  const nextAt = toApiDateTime(form.value.next_maintenance_at);
  if (nextAt) payload.next_maintenance_at = nextAt;
  const nextNotes = form.value.next_maintenance_notes.trim();
  if (nextNotes) payload.next_maintenance_notes = nextNotes;
  return { payload };
}

function saveErrorMessage(failure) {
  if (failure?.status === 403) return 'No tienes permiso para crear visitas.';
  if (failure?.status === 404) return 'La planta seleccionada ya no está disponible.';
  if (failure?.status === 400) return 'Revisa los datos ingresados e inténtalo de nuevo.';
  return 'No se pudo crear la visita. Comprueba la conexión y vuelve a intentarlo.';
}

async function saveForm() {
  if (formSaving.value) return;
  formError.value = '';
  const { payload, error: validationError } = buildPayload();
  if (validationError) {
    formError.value = validationError;
    return;
  }
  formSaving.value = true;
  try {
    const created = await createMaintenanceVisit(payload, { signal: controller.signal });
    visits.value = [created, ...visits.value];
    formSaving.value = false;
    closeForm();
  } catch (failure) {
    if (!controller.signal.aborted) {
      formError.value = saveErrorMessage(failure);
    }
  } finally {
    formSaving.value = false;
  }
}

const canCreate = computed(() => myRole.value === 'rdx_admin' || myRole.value === 'client_admin');

const now = () => Date.now();

const scheduledVisits = computed(() => visits.value.filter(visit => visit.status === 'scheduled'));

const kpis = computed(() => {
  const current = now();
  const in30Days = current + 30 * 24 * 60 * 60 * 1000;
  let upcoming = 0;
  let overdue = 0;
  for (const visit of scheduledVisits.value) {
    const time = visit.scheduled_at ? Date.parse(visit.scheduled_at) : NaN;
    if (!Number.isFinite(time)) continue;
    if (time < current) overdue += 1;
    else if (time <= in30Days) upcoming += 1;
  }
  return {
    scheduled: scheduledVisits.value.length,
    upcoming,
    overdue,
    completed: visits.value.filter(visit => visit.status === 'completed').length,
  };
});

const plantOptions = computed(() => plants.value.map(plant => ({
  id: plant.id,
  name: plant.name ?? plant.id,
})));

const filtered = computed(() => visits.value.filter(visit => {
  if (plantFilter.value !== 'all' && visit.plant_id !== plantFilter.value) return false;
  if (statusFilter.value !== 'all' && visit.status !== statusFilter.value) return false;
  const day = visit.scheduled_at ? String(visit.scheduled_at).slice(0, 10) : '';
  if (dateFrom.value && (!day || day < dateFrom.value)) return false;
  if (dateTo.value && (!day || day > dateTo.value)) return false;
  return true;
}));

function statusLabel(status) {
  return statusLabels[status] ?? status ?? 'Sin datos';
}

function priorityLabel(priority) {
  return priorityLabels[priority] ?? priority ?? 'Sin datos';
}

function plantName(plantId) {
  return plantNames.value[plantId] ?? 'Sin datos';
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

function formatAmount(visit) {
  if (visit.service_amount === null || visit.service_amount === undefined || visit.service_amount === '') {
    return '—';
  }
  return `${visit.service_amount} ${visit.currency ?? 'BOB'}`;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const me = await getMyProfile();
    myRole.value = me?.profile?.role ?? null;
    const [visitData, plantData] = await Promise.all([
      listMaintenanceVisits({}, { signal: controller.signal }),
      apiFetch('/plants', { signal: controller.signal }).catch(() => []),
    ]);
    if (!Array.isArray(visitData)) throw new Error('Respuesta inválida');
    visits.value = visitData;
    const plantList = Array.isArray(plantData) ? plantData : [];
    plants.value = plantList;
    plantNames.value = Object.fromEntries(
      plantList.map(plant => [plant.id, plant.name ?? plant.id]),
    );
  } catch (failure) {
    if (!controller.signal.aborted) {
      error.value = 'No se pudieron cargar las visitas de mantenimiento. Comprueba la conexión y vuelve a intentarlo.';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="maintenance-page">
    <header class="page-header maintenance-header">
      <div>
        <p class="eyebrow">RDX SOLAR MONITOR</p>
        <h1>Mantenimiento</h1>
        <p class="page-description">
          Visitas de mantenimiento programadas para las plantas fotovoltaicas.
        </p>
      </div>
      <button v-if="canCreate" class="primary-button" type="button" @click="openCreate">Nueva visita</button>
    </header>

    <section class="kpi-grid">
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">PROGRAMADOS</span></div>
        <strong class="kpi-value">{{ kpis.scheduled }}</strong>
        <span class="kpi-state">Visitas programadas</span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">PRÓXIMOS 30 DÍAS</span></div>
        <strong class="kpi-value">{{ kpis.upcoming }}</strong>
        <span class="kpi-state">Programadas en 30 días</span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">VENCIDOS</span></div>
        <strong class="kpi-value">{{ kpis.overdue }}</strong>
        <span class="kpi-state" :class="{ warning: kpis.overdue > 0 }">
          {{ kpis.overdue ? 'Requieren reprogramación' : 'Al día' }}
        </span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">COMPLETADOS</span></div>
        <strong class="kpi-value">{{ kpis.completed }}</strong>
        <span class="kpi-state">Visitas completadas</span>
      </article>
    </section>

    <section class="card filters-card">
      <div class="filters-grid">
        <label class="filter-field">
          <span>Planta</span>
          <select v-model="plantFilter">
            <option value="all">Todas</option>
            <option v-for="option in plantOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
        </label>
        <label class="filter-field">
          <span>Estado</span>
          <select v-model="statusFilter">
            <option value="all">Todos</option>
            <option value="scheduled">Programado</option>
            <option value="in_progress">En progreso</option>
            <option value="completed">Completado</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </label>
        <label class="filter-field">
          <span>Tipo de actividad <small class="soon-note">(próximamente)</small></span>
          <select disabled title="El filtrado por actividad estará disponible próximamente">
            <option>Todos</option>
          </select>
        </label>
        <label class="filter-field">
          <span>Desde</span>
          <input v-model="dateFrom" type="date" />
        </label>
        <label class="filter-field">
          <span>Hasta</span>
          <input v-model="dateTo" type="date" />
        </label>
      </div>
    </section>

    <section class="card visits-card">
      <div class="section-header">
        <div>
          <p class="section-eyebrow">VISITAS</p>
          <h2>Listado de visitas</h2>
        </div>
        <span class="visit-count">{{ filtered.length }}</span>
      </div>

      <div v-if="loading" class="empty-state" role="status">
        <div class="empty-icon loading-icon">↻</div>
        <strong>Consultando visitas</strong>
        <p>Recopilando la información de mantenimiento.</p>
      </div>

      <div v-else-if="error" class="empty-state" role="alert">
        <div class="empty-icon error-icon">!</div>
        <strong>No se pudo cargar</strong>
        <p>{{ error }}</p>
      </div>

      <div v-else-if="!filtered.length" class="empty-state">
        <div class="empty-icon success-icon">✓</div>
        <strong>Sin visitas</strong>
        <p>No hay visitas de mantenimiento para los filtros seleccionados.</p>
      </div>

      <div v-else class="table-wrapper">
        <table class="visit-table">
          <thead>
            <tr>
              <th>Fecha programada</th>
              <th>Planta</th>
              <th>Título</th>
              <th>Prioridad</th>
              <th>Estado</th>
              <th>Técnico</th>
              <th>Monto</th>
              <th>Próximo mantenimiento</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="visit in filtered" :key="visit.id">
              <td class="date-cell">{{ formatDate(visit.scheduled_at) }}</td>
              <td class="plant-name">{{ plantName(visit.plant_id) }}</td>
              <td>{{ visit.title }}</td>
              <td>{{ priorityLabel(visit.priority) }}</td>
              <td>
                <span class="status-badge" :class="visit.status">{{ statusLabel(visit.status) }}</span>
              </td>
              <td>{{ visit.technician_name ?? '—' }}</td>
              <td>{{ formatAmount(visit) }}</td>
              <td class="date-cell">{{ formatDate(visit.next_maintenance_at) }}</td>
              <td>
                <RouterLink class="detail-link" :to="`/maintenance/${visit.id}`">Ver detalle</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="showForm" class="modal-backdrop" @click.self="closeForm">
      <section class="card modal" role="dialog" aria-modal="true" aria-label="Nueva visita">
        <h2>Nueva visita</h2>
        <form @submit.prevent="saveForm">
          <fieldset>
            <legend>Visita</legend>
            <label for="visit-plant">Planta *</label>
            <select id="visit-plant" v-model="form.plant_id" required :disabled="formSaving">
              <option value="" disabled>Selecciona una planta</option>
              <option v-for="option in plantOptions" :key="option.id" :value="option.id">
                {{ option.name }}
              </option>
            </select>
            <label for="visit-title">Título *</label>
            <input id="visit-title" v-model="form.title" type="text" maxlength="200" required :disabled="formSaving" />
            <label for="visit-description">Descripción</label>
            <textarea id="visit-description" v-model="form.description" rows="2" :disabled="formSaving"></textarea>
            <label for="visit-priority">Prioridad *</label>
            <select id="visit-priority" v-model="form.priority" :disabled="formSaving">
              <option value="low">Baja</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </fieldset>
          <fieldset>
            <legend>Programación</legend>
            <label for="visit-scheduled">Fecha programada</label>
            <input id="visit-scheduled" v-model="form.scheduled_at" type="datetime-local" :disabled="formSaving" />
            <label for="visit-technician">Técnico responsable</label>
            <input id="visit-technician" v-model="form.technician_name" type="text" maxlength="160" :disabled="formSaving" />
            <label for="visit-observations">Observaciones generales</label>
            <textarea id="visit-observations" v-model="form.general_observations" rows="2" :disabled="formSaving"></textarea>
          </fieldset>
          <fieldset>
            <legend>Información económica</legend>
            <label for="visit-amount">Monto cobrado</label>
            <input id="visit-amount" v-model="form.service_amount" type="number" min="0" step="0.01" :disabled="formSaving" />
            <label for="visit-currency">Moneda</label>
            <input id="visit-currency" v-model="form.currency" type="text" maxlength="10" :disabled="formSaving" />
          </fieldset>
          <fieldset>
            <legend>Próximo mantenimiento</legend>
            <label for="visit-next">Fecha próximo mantenimiento</label>
            <input id="visit-next" v-model="form.next_maintenance_at" type="datetime-local" :disabled="formSaving" />
            <label for="visit-next-notes">Notas próximo mantenimiento</label>
            <textarea id="visit-next-notes" v-model="form.next_maintenance_notes" rows="2" :disabled="formSaving"></textarea>
          </fieldset>
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <div class="modal-actions">
            <button class="secondary-button" type="button" :disabled="formSaving" @click="closeForm">Cancelar</button>
            <button class="primary-button" type="submit" :disabled="formSaving">
              {{ formSaving ? 'Guardando…' : 'Crear visita' }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.maintenance-page {
  width: 100%;
  min-width: 0;
}

.maintenance-header {
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

.primary-button {
  flex-shrink: 0;
  padding: 10px 18px;
  border: none;
  border-radius: 10px;
  background: var(--rdx-accent);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
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

.filter-field select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.soon-note {
  font-weight: 400;
}

.visits-card {
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

.table-wrapper {
  width: 100%;
  overflow-x: auto;
}

.visit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.visit-table th {
  padding: 12px 16px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: left;
  white-space: nowrap;
}

.visit-table td {
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

.status-badge.completed {
  background: var(--rdx-success-soft);
  color: var(--rdx-success);
}

.status-badge.in_progress {
  background: var(--rdx-primary-soft);
  color: var(--rdx-accent);
}

.status-badge.cancelled {
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
}

.date-cell {
  white-space: nowrap;
}

.detail-link {
  color: var(--rdx-accent);
  font-weight: 700;
  white-space: nowrap;
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

.modal form {
  display: grid;
  gap: 12px;
}

.modal fieldset {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.modal legend {
  padding: 0;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--rdx-text-muted);
}

.modal label {
  font-size: 13px;
  font-weight: 600;
}

.modal input,
.modal select,
.modal textarea {
  padding: 10px 12px;
  border-radius: 8px;
  font: inherit;
}

.modal textarea {
  resize: vertical;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.form-error {
  color: var(--rdx-danger);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filters-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .maintenance-header {
    flex-direction: column;
  }
}

@media (max-width: 600px) {
  .kpi-grid,
  .filters-grid {
    grid-template-columns: 1fr;
  }

  .kpi-card {
    padding: 18px;
  }

  .section-header {
    padding: 17px 18px;
  }
}
</style>
