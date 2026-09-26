<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch, getMyProfile } from '../services/api.js';
import {
  createMaintenanceActivity,
  deleteMaintenanceActivity,
  getMaintenanceVisit,
  updateMaintenanceActivity,
  updateMaintenanceStatus,
  updateMaintenanceVisit,
} from '../services/maintenance.js';
import { deviceDisplayName } from '../utils/deviceDisplay.js';

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

const route = useRoute();

const visit = ref(null);
const plantName = ref('');
const loading = ref(true);
const error = ref('');
const notFound = ref(false);
const myRole = ref(null);

const controller = new AbortController();

const canManage = computed(() => myRole.value === 'rdx_admin' || myRole.value === 'client_admin');
const activities = computed(() => visit.value?.activities ?? []);

const devicesById = ref({});
const devicesLoaded = ref(false);
const devicesLoading = ref(false);

const showActivityForm = ref(false);
const editingActivity = ref(null);
const activitySaving = ref(false);
const activityError = ref('');
const activityScope = ref('plant');

function emptyActivityForm() {
  return {
    activity_type: 'inspection',
    title: '',
    device_id: '',
    work_performed: '',
    findings: '',
    actions_taken: '',
    observations: '',
  };
}

const activityForm = ref(emptyActivityForm());

const confirmingDelete = ref(null);
const deleteSaving = ref(false);

const pendingTransition = ref(null);
const transitionSaving = ref(false);
const transitionError = ref('');
const statusNotice = ref('');

const transitionMessages = {
  in_progress: {
    title: 'Iniciar visita',
    body: '¿Deseas iniciar esta visita de mantenimiento?',
    confirm: 'Iniciar',
  },
  completed: {
    title: 'Completar visita',
    body: '¿Deseas marcar esta visita como completada? Esta acción no podrá revertirse.',
    confirm: 'Completar',
  },
  cancelled: {
    title: 'Cancelar visita',
    body: '¿Deseas cancelar esta visita? Esta acción no podrá revertirse.',
    confirm: 'Cancelar',
  },
};

const statusActions = computed(() => {
  if (!canManage.value) return [];
  if (visit.value?.status === 'scheduled') return ['in_progress', 'cancelled'];
  if (visit.value?.status === 'in_progress') return ['completed', 'cancelled'];
  return [];
});

function transitionLabel(target) {
  if (target === 'in_progress') return 'Iniciar visita';
  if (target === 'completed') return 'Completar visita';
  return 'Cancelar visita';
}

function askTransition(target) {
  statusNotice.value = '';
  transitionError.value = '';
  if (target === 'completed' && activities.value.length === 0) {
    statusNotice.value = 'Debes registrar al menos una actividad antes de completar la visita.';
    return;
  }
  pendingTransition.value = target;
}

function closeTransitionConfirm() {
  if (transitionSaving.value) return;
  pendingTransition.value = null;
  transitionError.value = '';
}

function transitionErrorMessage(failure) {
  if (failure?.status === 400) return 'La transición no es válida para el estado actual de la visita.';
  if (failure?.status === 403) return 'No tienes permiso para cambiar el estado de la visita.';
  if (failure?.status === 404) return 'La visita ya no está disponible.';
  return 'No se pudo actualizar el estado. Comprueba la conexión y vuelve a intentarlo.';
}

async function applyTransition() {
  const target = pendingTransition.value;
  if (!target || transitionSaving.value) return;
  transitionSaving.value = true;
  transitionError.value = '';
  try {
    const updated = await updateMaintenanceStatus(
      visit.value.id, target, { signal: controller.signal });
    visit.value = { ...updated, activities: activities.value };
    statusNotice.value = '';
    pendingTransition.value = null;
  } catch (failure) {
    if (!controller.signal.aborted) {
      transitionError.value = transitionErrorMessage(failure);
    }
  } finally {
    transitionSaving.value = false;
  }
}

const showEditForm = ref(false);
const editSaving = ref(false);
const editError = ref('');

function emptyEditForm() {
  return {
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

const editForm = ref(emptyEditForm());

function toLocalInput(value) {
  if (!value) return '';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openEditVisit() {
  const current = visit.value;
  editForm.value = {
    title: current.title ?? '',
    description: current.description ?? '',
    priority: current.priority ?? 'normal',
    scheduled_at: toLocalInput(current.scheduled_at),
    technician_name: current.technician_name ?? '',
    general_observations: current.general_observations ?? '',
    service_amount: current.service_amount ?? '',
    currency: current.currency ?? 'BOB',
    next_maintenance_at: toLocalInput(current.next_maintenance_at),
    next_maintenance_notes: current.next_maintenance_notes ?? '',
  };
  editError.value = '';
  editSaving.value = false;
  showEditForm.value = true;
}

function closeEditForm() {
  if (editSaving.value) return;
  showEditForm.value = false;
  editError.value = '';
}

function buildEditPayload() {
  const title = editForm.value.title.trim();
  if (!title) return { error: 'El título es obligatorio.' };
  if (!['low', 'normal', 'high', 'urgent'].includes(editForm.value.priority)) {
    return { error: 'Selecciona una prioridad válida.' };
  }
  let serviceAmount = null;
  if (String(editForm.value.service_amount ?? '').trim() !== '') {
    serviceAmount = Number(editForm.value.service_amount);
    if (!Number.isFinite(serviceAmount) || serviceAmount < 0) {
      return { error: 'El monto debe ser mayor o igual a 0.' };
    }
  }
  const payload = { title, priority: editForm.value.priority, service_amount: serviceAmount };
  for (const field of ['description', 'technician_name', 'general_observations', 'next_maintenance_notes']) {
    const value = editForm.value[field].trim();
    payload[field] = value ? value : null;
  }
  const scheduledAt = editForm.value.scheduled_at ? Date.parse(editForm.value.scheduled_at) : NaN;
  payload.scheduled_at = Number.isFinite(scheduledAt) ? new Date(scheduledAt).toISOString() : null;
  const nextAt = editForm.value.next_maintenance_at ? Date.parse(editForm.value.next_maintenance_at) : NaN;
  payload.next_maintenance_at = Number.isFinite(nextAt) ? new Date(nextAt).toISOString() : null;
  const currency = editForm.value.currency.trim();
  payload.currency = currency || 'BOB';
  return { payload };
}

function editErrorMessage(failure) {
  if (failure?.status === 400) return 'Revisa los datos ingresados e inténtalo de nuevo.';
  if (failure?.status === 403) return 'No tienes permiso para editar esta visita.';
  if (failure?.status === 404) return 'La visita ya no está disponible.';
  return 'No se pudo guardar la visita. Comprueba la conexión y vuelve a intentarlo.';
}

async function saveEditForm() {
  if (editSaving.value) return;
  editError.value = '';
  const { payload, error: validationError } = buildEditPayload();
  if (validationError) {
    editError.value = validationError;
    return;
  }
  editSaving.value = true;
  try {
    const updated = await updateMaintenanceVisit(visit.value.id, payload, { signal: controller.signal });
    visit.value = { ...updated, activities: activities.value };
    editSaving.value = false;
    closeEditForm();
  } catch (failure) {
    if (!controller.signal.aborted) {
      editError.value = editErrorMessage(failure);
    }
  } finally {
    editSaving.value = false;
  }
}

const plantDevices = computed(() => Object.values(devicesById.value)
  .filter(device => device.plant_id === visit.value?.plant_id));

async function ensureDevices() {
  if (devicesLoaded.value || devicesLoading.value) return;
  devicesLoading.value = true;
  try {
    const data = await apiFetch('/devices', { signal: controller.signal });
    devicesById.value = Object.fromEntries(
      (Array.isArray(data) ? data : []).map(device => [device.id, device]),
    );
    devicesLoaded.value = true;
  } catch {
    if (!controller.signal.aborted) devicesById.value = {};
  } finally {
    devicesLoading.value = false;
  }
}

function openCreateActivity() {
  activityForm.value = emptyActivityForm();
  activityScope.value = 'plant';
  editingActivity.value = null;
  activityError.value = '';
  activitySaving.value = false;
  showActivityForm.value = true;
  void ensureDevices();
}

function openEditActivity(activity) {
  activityForm.value = {
    activity_type: activity.activity_type ?? 'inspection',
    title: activity.title ?? '',
    device_id: activity.device_id ?? '',
    work_performed: activity.work_performed ?? '',
    findings: activity.findings ?? '',
    actions_taken: activity.actions_taken ?? '',
    observations: activity.observations ?? '',
  };
  activityScope.value = activity.device_id ? 'device' : 'plant';
  editingActivity.value = activity;
  activityError.value = '';
  activitySaving.value = false;
  showActivityForm.value = true;
  void ensureDevices();
}

function closeActivityForm() {
  if (activitySaving.value) return;
  showActivityForm.value = false;
  activityError.value = '';
}

function buildActivityPayload() {
  const title = activityForm.value.title.trim();
  if (!activityForm.value.activity_type || !(activityForm.value.activity_type in activityTypeLabels)) {
    return { error: 'Selecciona un tipo de actividad válido.' };
  }
  if (!title) return { error: 'El título es obligatorio.' };
  let deviceId = null;
  if (activityScope.value === 'device') {
    if (!activityForm.value.device_id) return { error: 'Selecciona un dispositivo.' };
    deviceId = activityForm.value.device_id;
  }
  const payload = { activity_type: activityForm.value.activity_type, title, device_id: deviceId };
  for (const field of ['work_performed', 'findings', 'actions_taken', 'observations']) {
    const value = activityForm.value[field].trim();
    if (value) payload[field] = value;
  }
  return { payload };
}

function activityErrorMessage(failure) {
  if (failure?.status === 400) return 'Revisa los datos ingresados e inténtalo de nuevo.';
  if (failure?.status === 403) return 'No tienes permiso para esta acción.';
  if (failure?.status === 404) return 'La visita, la actividad o el dispositivo ya no está disponible.';
  return 'No se pudo guardar la actividad. Comprueba la conexión y vuelve a intentarlo.';
}

async function saveActivityForm() {
  if (activitySaving.value) return;
  activityError.value = '';
  const { payload, error: validationError } = buildActivityPayload();
  if (validationError) {
    activityError.value = validationError;
    return;
  }
  activitySaving.value = true;
  try {
    if (editingActivity.value) {
      const updated = await updateMaintenanceActivity(
        visit.value.id, editingActivity.value.id, payload, { signal: controller.signal });
      visit.value = {
        ...visit.value,
        activities: activities.value.map(item => (item.id === updated.id ? updated : item)),
      };
    } else {
      const created = await createMaintenanceActivity(
        visit.value.id, payload, { signal: controller.signal });
      visit.value = { ...visit.value, activities: [...activities.value, created] };
    }
    activitySaving.value = false;
    closeActivityForm();
  } catch (failure) {
    if (!controller.signal.aborted) {
      activityError.value = activityErrorMessage(failure);
    }
  } finally {
    activitySaving.value = false;
  }
}

function askDeleteActivity(activity) {
  confirmingDelete.value = activity;
}

function closeDeleteConfirm() {
  if (deleteSaving.value) return;
  confirmingDelete.value = null;
}

async function applyDeleteActivity() {
  const activity = confirmingDelete.value;
  if (!activity || deleteSaving.value) return;
  deleteSaving.value = true;
  try {
    await deleteMaintenanceActivity(visit.value.id, activity.id, { signal: controller.signal });
    visit.value = {
      ...visit.value,
      activities: activities.value.filter(item => item.id !== activity.id),
    };
    confirmingDelete.value = null;
  } catch {
    if (!controller.signal.aborted) {
      activityError.value = 'No se pudo eliminar la actividad. Comprueba la conexión y vuelve a intentarlo.';
      confirmingDelete.value = null;
    }
  } finally {
    deleteSaving.value = false;
  }
}

function text(value) {
  return value ?? '—';
}

function statusLabel(status) {
  return statusLabels[status] ?? status ?? 'Sin datos';
}

function priorityLabel(priority) {
  return priorityLabels[priority] ?? priority ?? 'Sin datos';
}

function activityTypeLabel(type) {
  return activityTypeLabels[type] ?? type ?? 'Sin datos';
}

function deviceLabel(deviceId) {
  if (!deviceId) return 'Planta completa';
  const device = devicesById.value[deviceId];
  if (device) return deviceDisplayName(device);
  return `Dispositivo ${String(deviceId).slice(0, 8)}`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function hasNextMaintenance() {
  return Boolean(visit.value?.next_maintenance_at || visit.value?.next_maintenance_notes);
}

async function load() {
  loading.value = true;
  error.value = '';
  notFound.value = false;
  statusNotice.value = '';
  try {
    const me = await getMyProfile();
    myRole.value = me?.profile?.role ?? null;
    const data = await getMaintenanceVisit(route.params.id, { signal: controller.signal });
    if (!data || typeof data !== 'object') throw new Error('Respuesta inválida');
    visit.value = data;
    const plants = await apiFetch('/plants', { signal: controller.signal }).catch(() => []);
    const match = (Array.isArray(plants) ? plants : []).find(plant => plant.id === data.plant_id);
    plantName.value = match?.name ?? 'Sin datos';
  } catch (failure) {
    if (controller.signal.aborted) return;
    if (failure?.status === 404) notFound.value = true;
    else error.value = 'No se pudo cargar la visita de mantenimiento. Comprueba la conexión y vuelve a intentarlo.';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="detail-page">
    <RouterLink class="back-link" to="/maintenance">‹ Volver a Mantenimiento</RouterLink>

    <div v-if="loading" class="card empty-state" role="status">Cargando visita…</div>

    <div v-else-if="notFound" class="card empty-state" role="alert">
      <strong>Visita no encontrada</strong>
      <p>La visita solicitada no existe o no tienes acceso a ella.</p>
    </div>

    <div v-else-if="error" class="card empty-state" role="alert">
      <strong>No se pudo cargar</strong>
      <p>{{ error }}</p>
    </div>

    <template v-else-if="visit">
      <header class="page-header detail-header">
        <div>
          <p class="eyebrow">{{ plantName }}</p>
          <h1>{{ visit.title }}</h1>
          <div class="badge-row">
            <span class="status-badge" :class="visit.status">{{ statusLabel(visit.status) }}</span>
            <span class="priority-badge">{{ priorityLabel(visit.priority) }}</span>
          </div>
        </div>
        <div v-if="canManage" class="header-actions">
          <button class="secondary-button" type="button" @click="openEditVisit">Editar visita</button>
          <button class="primary-button" type="button" @click="openCreateActivity">Agregar actividad</button>
        </div>
      </header>

      <div v-if="statusActions.length" class="card status-actions-card">
        <div class="status-actions-row">
          <button
            v-for="target in statusActions"
            :key="target"
            :class="target === 'cancelled' ? 'secondary-button' : 'primary-button'"
            type="button"
            @click="askTransition(target)"
          >
            {{ transitionLabel(target) }}
          </button>
        </div>
        <p v-if="statusNotice" class="status-notice" role="alert">{{ statusNotice }}</p>
      </div>

      <div class="info-grid">
        <section class="card info-card">
          <h2>Información general</h2>
          <dl>
            <div><dt>Fecha programada</dt><dd>{{ formatDate(visit.scheduled_at) }}</dd></div>
            <div><dt>Técnico responsable</dt><dd>{{ text(visit.technician_name) }}</dd></div>
            <div><dt>Descripción</dt><dd>{{ text(visit.description) }}</dd></div>
            <div><dt>Observaciones generales</dt><dd>{{ text(visit.general_observations) }}</dd></div>
            <div><dt>Fecha de creación</dt><dd>{{ formatDate(visit.created_at) }}</dd></div>
            <div v-if="visit.completed_at"><dt>Fecha de finalización</dt><dd>{{ formatDate(visit.completed_at) }}</dd></div>
          </dl>
        </section>

        <div class="side-stack">
          <section class="card info-card">
            <h2>Información económica</h2>
            <p v-if="visit.service_amount === null || visit.service_amount === undefined" class="muted">
              Sin monto registrado
            </p>
            <dl v-else>
              <div><dt>Monto cobrado</dt><dd>{{ visit.service_amount }} {{ visit.currency ?? 'BOB' }}</dd></div>
              <div><dt>Moneda</dt><dd>{{ visit.currency ?? 'BOB' }}</dd></div>
            </dl>
          </section>

          <section class="card info-card">
            <h2>Próximo mantenimiento</h2>
            <dl v-if="hasNextMaintenance()">
              <div v-if="visit.next_maintenance_at"><dt>Fecha</dt><dd>{{ formatDate(visit.next_maintenance_at) }}</dd></div>
              <div v-if="visit.next_maintenance_notes"><dt>Notas</dt><dd>{{ visit.next_maintenance_notes }}</dd></div>
            </dl>
            <p v-else class="muted">Sin próximo mantenimiento programado.</p>
          </section>
        </div>
      </div>

      <section class="card activities-card">
        <div class="section-header">
          <h2>Actividades realizadas</h2>
          <span class="activity-count">{{ activities.length }}</span>
        </div>
        <div v-if="!activities.length" class="empty-activities">
          No hay actividades registradas.
        </div>
        <ul v-else class="activity-list">
          <li v-for="activity in activities" :key="activity.id" class="activity-item">
            <div class="activity-head">
              <span class="activity-type">{{ activityTypeLabel(activity.activity_type) }}</span>
              <span class="activity-device">{{ deviceLabel(activity.device_id) }}</span>
            </div>
            <strong class="activity-title">{{ activity.title }}</strong>
            <div v-if="canManage" class="activity-actions">
              <button class="link-button" type="button" @click="openEditActivity(activity)">Editar</button>
              <button class="link-button danger" type="button" @click="askDeleteActivity(activity)">Eliminar</button>
            </div>
            <dl class="activity-details">
              <div v-if="activity.work_performed"><dt>Trabajo realizado</dt><dd>{{ activity.work_performed }}</dd></div>
              <div v-if="activity.findings"><dt>Hallazgos</dt><dd>{{ activity.findings }}</dd></div>
              <div v-if="activity.actions_taken"><dt>Acciones tomadas</dt><dd>{{ activity.actions_taken }}</dd></div>
              <div v-if="activity.observations"><dt>Observaciones</dt><dd>{{ activity.observations }}</dd></div>
            </dl>
          </li>
        </ul>
      </section>
    </template>

    <div v-if="pendingTransition" class="modal-backdrop" @click.self="closeTransitionConfirm">
      <section class="card modal modal-narrow" role="dialog" aria-modal="true" :aria-label="transitionMessages[pendingTransition].title">
        <h2>{{ transitionMessages[pendingTransition].title }}</h2>
        <p>{{ transitionMessages[pendingTransition].body }}</p>
        <p v-if="transitionError" class="form-error" role="alert">{{ transitionError }}</p>
        <div class="modal-actions">
          <button class="secondary-button" type="button" :disabled="transitionSaving" @click="closeTransitionConfirm">Volver</button>
          <button class="primary-button" type="button" :disabled="transitionSaving" @click="applyTransition">
            {{ transitionSaving ? 'Guardando…' : transitionMessages[pendingTransition].confirm }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="showEditForm" class="modal-backdrop" @click.self="closeEditForm">
      <section class="card modal" role="dialog" aria-modal="true" aria-label="Editar visita">
        <h2>Editar visita</h2>
        <p class="muted">Planta: {{ plantName }}</p>
        <form @submit.prevent="saveEditForm">
          <label for="edit-title">Título *</label>
          <input id="edit-title" v-model="editForm.title" type="text" maxlength="200" required :disabled="editSaving" />
          <label for="edit-priority">Prioridad *</label>
          <select id="edit-priority" v-model="editForm.priority" :disabled="editSaving">
            <option value="low">Baja</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </select>
          <label for="edit-scheduled">Fecha programada</label>
          <input id="edit-scheduled" v-model="editForm.scheduled_at" type="datetime-local" :disabled="editSaving" />
          <label for="edit-technician">Técnico responsable</label>
          <input id="edit-technician" v-model="editForm.technician_name" type="text" maxlength="160" :disabled="editSaving" />
          <label for="edit-description">Descripción</label>
          <textarea id="edit-description" v-model="editForm.description" rows="2" :disabled="editSaving"></textarea>
          <label for="edit-observations">Observaciones generales</label>
          <textarea id="edit-observations" v-model="editForm.general_observations" rows="2" :disabled="editSaving"></textarea>
          <label for="edit-amount">Monto cobrado</label>
          <input id="edit-amount" v-model="editForm.service_amount" type="number" min="0" step="0.01" :disabled="editSaving" />
          <label for="edit-currency">Moneda</label>
          <input id="edit-currency" v-model="editForm.currency" type="text" maxlength="10" :disabled="editSaving" />
          <label for="edit-next">Fecha próximo mantenimiento</label>
          <input id="edit-next" v-model="editForm.next_maintenance_at" type="datetime-local" :disabled="editSaving" />
          <label for="edit-next-notes">Notas próximo mantenimiento</label>
          <textarea id="edit-next-notes" v-model="editForm.next_maintenance_notes" rows="2" :disabled="editSaving"></textarea>
          <p v-if="editError" class="form-error" role="alert">{{ editError }}</p>
          <div class="modal-actions">
            <button class="secondary-button" type="button" :disabled="editSaving" @click="closeEditForm">Cancelar</button>
            <button class="primary-button" type="submit" :disabled="editSaving">
              {{ editSaving ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="showActivityForm" class="modal-backdrop" @click.self="closeActivityForm">
      <section class="card modal" role="dialog" aria-modal="true" :aria-label="editingActivity ? 'Editar actividad' : 'Agregar actividad'">
        <h2>{{ editingActivity ? 'Editar actividad' : 'Agregar actividad' }}</h2>
        <form @submit.prevent="saveActivityForm">
          <label for="activity-type">Tipo *</label>
          <select id="activity-type" v-model="activityForm.activity_type" required :disabled="activitySaving">
            <option value="inspection">Inspección</option>
            <option value="preventive">Preventivo</option>
            <option value="corrective">Correctivo</option>
            <option value="cleaning">Limpieza</option>
            <option value="other">Otro</option>
          </select>
          <label for="activity-title">Título *</label>
          <input id="activity-title" v-model="activityForm.title" type="text" maxlength="200" required :disabled="activitySaving" />
          <fieldset class="scope-fieldset">
            <legend>Alcance</legend>
            <label class="scope-option">
              <input v-model="activityScope" value="plant" type="radio" :disabled="activitySaving" />
              Planta completa
            </label>
            <label class="scope-option">
              <input v-model="activityScope" value="device" type="radio" :disabled="activitySaving" />
              Dispositivo específico
            </label>
          </fieldset>
          <template v-if="activityScope === 'device'">
            <label for="activity-device">Dispositivo *</label>
            <select
              v-if="!devicesLoading && plantDevices.length"
              id="activity-device"
              v-model="activityForm.device_id"
              required
              :disabled="activitySaving"
            >
              <option value="" disabled>Selecciona un dispositivo</option>
              <option v-for="device in plantDevices" :key="device.id" :value="device.id">
                {{ deviceDisplayName(device) }}
              </option>
            </select>
            <p v-else class="muted">{{ devicesLoading ? 'Cargando dispositivos…' : 'Sin dispositivos en esta planta.' }}</p>
          </template>
          <label for="activity-work">Trabajo realizado</label>
          <textarea id="activity-work" v-model="activityForm.work_performed" rows="2" :disabled="activitySaving"></textarea>
          <label for="activity-findings">Hallazgos</label>
          <textarea id="activity-findings" v-model="activityForm.findings" rows="2" :disabled="activitySaving"></textarea>
          <label for="activity-actions">Acciones tomadas</label>
          <textarea id="activity-actions" v-model="activityForm.actions_taken" rows="2" :disabled="activitySaving"></textarea>
          <label for="activity-observations">Observaciones</label>
          <textarea id="activity-observations" v-model="activityForm.observations" rows="2" :disabled="activitySaving"></textarea>
          <p v-if="activityError" class="form-error" role="alert">{{ activityError }}</p>
          <div class="modal-actions">
            <button class="secondary-button" type="button" :disabled="activitySaving" @click="closeActivityForm">Cancelar</button>
            <button class="primary-button" type="submit" :disabled="activitySaving">
              {{ activitySaving ? 'Guardando…' : editingActivity ? 'Guardar' : 'Agregar' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="confirmingDelete" class="modal-backdrop" @click.self="closeDeleteConfirm">
      <section class="card modal modal-narrow" role="dialog" aria-modal="true" aria-label="Confirmar eliminación">
        <h2>Eliminar actividad</h2>
        <p>La actividad se eliminará de la visita. Esta acción no se puede deshacer.</p>
        <div class="modal-actions">
          <button class="secondary-button" type="button" :disabled="deleteSaving" @click="closeDeleteConfirm">Cancelar</button>
          <button class="primary-button danger-button" type="button" :disabled="deleteSaving" @click="applyDeleteActivity">
            {{ deleteSaving ? 'Eliminando…' : 'Eliminar' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.detail-page {
  width: 100%;
  min-width: 0;
}

.back-link {
  display: inline-block;
  margin-bottom: 14px;
  color: var(--rdx-text);
  font-size: 13px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--rdx-text-muted);
}

h1 {
  margin: 4px 0;
}

.badge-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.status-badge {
  display: inline-flex;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 12px;
  font-weight: 700;
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

.priority-badge {
  display: inline-flex;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--rdx-border);
  color: var(--rdx-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  gap: 10px;
}

.primary-button {
  padding: 10px 16px;
  border: 0;
  border-radius: 8px;
  background: var(--rdx-primary);
  color: white;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
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
  white-space: nowrap;
}

.info-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 18px;
  margin-bottom: 18px;
}

.side-stack {
  display: grid;
  gap: 18px;
  align-content: start;
}

.info-card {
  min-width: 0;
  padding: 20px 22px;
}

.info-card h2,
.activities-card h2 {
  margin: 0 0 12px;
  font-size: 16px;
}

.info-card dl,
.activity-details {
  display: grid;
  gap: 10px;
  margin: 0;
}

.info-card dt,
.activity-details dt {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--rdx-text-muted);
}

.info-card dd,
.activity-details dd {
  margin: 2px 0 0;
  color: var(--rdx-text-strong);
  font-size: 14px;
}

.muted {
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.activities-card {
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
  margin: 0;
}

.activity-count {
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

.empty-activities {
  padding: 28px 22px;
  color: var(--rdx-text-muted);
  font-size: 13px;
  text-align: center;
}

.activity-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.activity-item {
  padding: 18px 22px;
  border-top: 1px solid var(--rdx-border);
}

.activity-item:first-child {
  border-top: 0;
}

.activity-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.activity-type {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--rdx-primary-soft);
  color: var(--rdx-accent);
  font-size: 11px;
  font-weight: 700;
}

.activity-device {
  font-size: 12px;
  color: var(--rdx-text-muted);
}

.activity-title {
  color: var(--rdx-text-strong);
  font-size: 14px;
}

.activity-actions {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}

.link-button {
  border: 0;
  background: none;
  padding: 4px 6px;
  color: var(--rdx-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.link-button.danger {
  color: var(--rdx-danger);
}

.status-actions-card {
  padding: 16px 22px;
  margin-bottom: 18px;
}

.status-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.status-notice {
  margin: 10px 0 0;
  color: var(--rdx-warning);
  font-size: 13px;
  font-weight: 600;
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
  max-width: 520px;
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
}

.modal-narrow {
  max-width: 440px;
}

.modal h2 {
  margin: 0 0 12px;
  font-size: 18px;
}

.modal form {
  display: grid;
  gap: 8px;
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

.scope-fieldset {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
}

.scope-fieldset legend {
  padding: 0;
  margin-bottom: 2px;
  font-size: 13px;
  font-weight: 600;
}

.scope-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 400 !important;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}

.form-error {
  color: var(--rdx-danger);
  font-size: 13px;
}

.danger-button {
  background: var(--rdx-danger);
}

.activity-details {
  margin-top: 10px;
}

.empty-state {
  text-align: center;
  padding: 32px 20px;
}

@media (max-width: 900px) {
  .info-grid {
    grid-template-columns: 1fr;
  }

  .page-header {
    flex-direction: column;
  }
}
</style>
