<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { getMyProfile } from '../services/api.js';
import { cancelRequest, deliverRequest, getRequest, listAvailableItems, prepareSerializedItem, releaseSerializedItem, setPreparedQuantity, transitionRequest } from '../services/operations.js';
import { buildDeliveries, cancellableStatus, eventLabel, friendlyOperationsError, isPartialDelivery, isWarehouseRole, newIdempotencyKey, priorityLabel, reasonLabel, statusLabel, transitionActions } from '../utils/operations.js';

const route = useRoute();

const detail = ref(null);
const loading = ref(true);
const error = ref('');
const notFound = ref(false);
const myRole = ref(null);

const controller = new AbortController();

const request = computed(() => detail.value?.request ?? null);
const lines = computed(() => detail.value?.lines ?? []);
const items = computed(() => detail.value?.items ?? []);
const events = computed(() => detail.value?.events ?? []);

const isWarehouse = computed(() => isWarehouseRole(myRole.value));
const actions = computed(() => {
  if (!isWarehouse.value) return [];
  return transitionActions(request.value?.status);
});
const showCancel = computed(() => {
  if (!cancellableStatus(request.value?.status)) return false;
  return isWarehouse.value || myRole.value === 'client_user';
});
const showDeliver = computed(() => isWarehouse.value && request.value?.status === 'ready');
const canPrepare = computed(() => isWarehouse.value && request.value?.status === 'preparing');

const progressSteps = [
  { key: 'requested', label: 'Solicitada' },
  { key: 'received', label: 'Recibida' },
  { key: 'preparing', label: 'En preparación' },
  { key: 'ready', label: 'Lista' },
  { key: 'delivered', label: 'Entregada' },
];

const progressIndex = computed(() => progressSteps.findIndex(step => step.key === request.value?.status));
const isTerminalFailure = computed(() => ['rejected', 'cancelled'].includes(request.value?.status));

function itemsForLine(lineId) {
  return items.value.filter(item => item.request_line_id === lineId
    && !item.delivered_at && !item.released_at);
}

function remainingToPrepare(line) {
  const requested = Number(line.requested_quantity ?? NaN);
  const prepared = Number(line.prepared_quantity ?? NaN);
  if (!Number.isFinite(requested) || !Number.isFinite(prepared)) return 0;
  return Math.max(0, requested - prepared);
}

function productKind(line) {
  return line.product?.tracking_mode === 'serialized' ? 'Serializado' : 'Por cantidad';
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function formatDay(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short' }).format(date);
}

function shortActor(actorId) {
  if (!actorId) return '—';
  return String(actorId).slice(0, 8);
}

async function load() {
  loading.value = true;
  error.value = '';
  notFound.value = false;
  try {
    const me = await getMyProfile();
    myRole.value = me?.profile?.role ?? null;
    detail.value = await getRequest(route.params.id, { signal: controller.signal });
  } catch (failure) {
    if (controller.signal.aborted) return;
    if (failure?.status === 404) notFound.value = true;
    else error.value = 'No se pudo cargar la solicitud. Comprueba la conexión y vuelve a intentarlo.';
  } finally {
    loading.value = false;
  }
}

// Una respuesta HTTP (4xx/5xx) es definitiva: la key se descarta.
// Un fallo sin status (red/timeout/aborto ambiguo) conserva la key
// para reintentar la misma acción sin duplicarla.
function isAmbiguous(failure) {
  return !failure || failure.status === undefined || failure.status === null;
}

// ---- Transiciones generales (recibir / preparar / lista / rechazar) ----

const pendingTransition = ref(null);
const transitionKey = ref(null);
const transitionSaving = ref(false);
const transitionError = ref('');

function askTransition(action) {
  transitionError.value = '';
  transitionKey.value = newIdempotencyKey();
  pendingTransition.value = action;
}

function closeTransitionConfirm() {
  if (transitionSaving.value) return;
  pendingTransition.value = null;
  transitionError.value = '';
  transitionKey.value = null;
}

async function confirmTransition() {
  const action = pendingTransition.value;
  if (!action || transitionSaving.value) return;
  transitionSaving.value = true;
  transitionError.value = '';
  try {
    await transitionRequest(request.value.id, action.target, transitionKey.value, {
      signal: controller.signal,
    });
    pendingTransition.value = null;
    transitionKey.value = null;
    await load();
  } catch (failure) {
    if (controller.signal.aborted) return;
    if (isAmbiguous(failure)) {
      transitionError.value = 'No se pudo confirmar la acción (fallo de red). Puedes reintentarla sin duplicarla.';
    } else {
      const raw = `${failure?.body?.error ?? ''} ${failure?.detail ?? ''}`;
      const inconsistent = /PREPARATION_INCONSISTENT|PREPARED_ITEMS_MISMATCH|inconsistente/i.test(raw);
      transitionError.value = action.target === 'ready' && inconsistent
        ? 'Revisa la preparación de los materiales antes de marcar la solicitud como lista.'
        : friendlyOperationsError(failure);
      pendingTransition.value = null;
      transitionKey.value = null;
    }
  } finally {
    transitionSaving.value = false;
  }
}

// ---- Cancelación ----

const showCancelConfirm = ref(false);
const cancelKey = ref(null);
const cancelSaving = ref(false);
const cancelError = ref('');

function askCancel() {
  cancelError.value = '';
  cancelKey.value = newIdempotencyKey();
  showCancelConfirm.value = true;
}

function closeCancelConfirm() {
  if (cancelSaving.value) return;
  showCancelConfirm.value = false;
  cancelError.value = '';
  cancelKey.value = null;
}

async function confirmCancel() {
  if (cancelSaving.value) return;
  cancelSaving.value = true;
  cancelError.value = '';
  try {
    await cancelRequest(request.value.id, cancelKey.value, { signal: controller.signal });
    showCancelConfirm.value = false;
    cancelKey.value = null;
    await load();
  } catch (failure) {
    if (controller.signal.aborted) return;
    if (isAmbiguous(failure)) {
      cancelError.value = 'No se pudo confirmar la cancelación (fallo de red). Puedes reintentarla sin duplicarla.';
    } else {
      cancelError.value = friendlyOperationsError(failure);
      showCancelConfirm.value = false;
      cancelKey.value = null;
    }
  } finally {
    cancelSaving.value = false;
  }
}

// ---- Preparación serialized ----

const serialPicker = ref(null);
const serialLoading = ref(false);
const serialError = ref('');
const serialSaving = ref(false);
const serialSelected = ref([]);

async function openSerialPicker(line) {
  serialError.value = '';
  serialSelected.value = [];
  serialLoading.value = true;
  serialPicker.value = { lineId: line.id, items: [] };
  try {
    const available = await listAvailableItems(request.value.id, line.id, {
      signal: controller.signal,
    });
    serialPicker.value = { lineId: line.id, items: Array.isArray(available) ? available : [] };
  } catch (failure) {
    if (!controller.signal.aborted) {
      serialError.value = friendlyOperationsError(failure);
    }
  } finally {
    serialLoading.value = false;
  }
}

function closeSerialPicker() {
  if (serialSaving.value) return;
  serialPicker.value = null;
  serialSelected.value = [];
  serialError.value = '';
}

function pickerLine() {
  return lines.value.find(line => line.id === serialPicker.value?.lineId) ?? null;
}

function toggleSerial(itemId) {
  const line = pickerLine();
  const limit = line ? remainingToPrepare(line) : 0;
  const selected = serialSelected.value;
  if (selected.includes(itemId)) {
    serialSelected.value = selected.filter(id => id !== itemId);
    return;
  }
  if (selected.length >= limit) return;
  serialSelected.value = [...selected, itemId];
}

async function confirmSerialSelection() {
  const line = pickerLine();
  if (!line || serialSelected.value.length === 0 || serialSaving.value) return;
  serialSaving.value = true;
  serialError.value = '';
  try {
    for (const itemId of serialSelected.value) {
      await prepareSerializedItem(request.value.id, line.id, { inventory_item_id: itemId }, {
        signal: controller.signal,
      });
    }
    closeSerialPickerForce();
    await load();
  } catch (failure) {
    if (!controller.signal.aborted) {
      serialError.value = friendlyOperationsError(failure);
    }
  } finally {
    serialSaving.value = false;
  }
}

function closeSerialPickerForce() {
  serialPicker.value = null;
  serialSelected.value = [];
  serialError.value = '';
}

const releasingItem = ref(null);

async function releaseItem(line, item) {
  if (releasingItem.value) return;
  releasingItem.value = item.id;
  try {
    await releaseSerializedItem(request.value.id, line.id, item.inventory_item_id, null, {
      signal: controller.signal,
    });
    await load();
  } catch (failure) {
    if (!controller.signal.aborted) {
      serialError.value = friendlyOperationsError(failure);
    }
  } finally {
    releasingItem.value = null;
  }
}

// ---- Preparación quantity ----

const quantityDrafts = ref({});
const quantitySaving = ref(null);
const quantityError = ref('');

function quantityDraft(line) {
  if (!(line.id in quantityDrafts.value)) {
    quantityDrafts.value[line.id] = String(line.prepared_quantity ?? '0');
  }
  return quantityDrafts.value[line.id];
}

function setQuantityDraft(line, value) {
  quantityDrafts.value[line.id] = value;
}

async function saveQuantity(line) {
  if (quantitySaving.value) return;
  quantityError.value = '';
  const raw = quantityDrafts.value[line.id] ?? line.prepared_quantity;
  const value = Number(raw);
  const requested = Number(line.requested_quantity ?? NaN);
  if (!Number.isFinite(value) || value < 0 || (Number.isFinite(requested) && value > requested)) {
    quantityError.value = 'Revisa la cantidad preparada (0 a lo solicitado).';
    return;
  }
  quantitySaving.value = line.id;
  try {
    // Solo registra lo preparado; el stock se descuenta al entregar.
    await setPreparedQuantity(request.value.id, line.id, { prepared_quantity: value }, {
      signal: controller.signal,
    });
    await load();
  } catch (failure) {
    if (!controller.signal.aborted) {
      quantityError.value = friendlyOperationsError(failure);
    }
  } finally {
    quantitySaving.value = null;
  }
}

// ---- Entrega ----

const showDeliverModal = ref(false);
const deliverQuantities = ref({});
const deliverKey = ref(null);
const deliverSaving = ref(false);
const deliverError = ref('');

function openDeliver() {
  deliverError.value = '';
  deliverSaving.value = false;
  deliverKey.value = newIdempotencyKey();
  const initial = {};
  for (const line of lines.value) {
    initial[line.id] = String(line.prepared_quantity ?? '0');
  }
  deliverQuantities.value = initial;
  showDeliverModal.value = true;
}

function closeDeliver() {
  if (deliverSaving.value) return;
  showDeliverModal.value = false;
  deliverError.value = '';
  deliverKey.value = null;
}

const deliverPreview = computed(() => {
  const { deliveries } = buildDeliveries(lines.value, deliverQuantities.value);
  return deliveries ?? {};
});

const deliverPartial = computed(() => {
  const { deliveries, error: buildError } = buildDeliveries(lines.value, deliverQuantities.value);
  if (buildError || !deliveries) return false;
  return isPartialDelivery(lines.value, deliveries);
});

async function confirmDeliver() {
  if (deliverSaving.value) return;
  deliverError.value = '';
  const { deliveries, error: buildError } = buildDeliveries(lines.value, deliverQuantities.value);
  if (buildError) {
    deliverError.value = buildError;
    return;
  }
  deliverSaving.value = true;
  try {
    await deliverRequest(request.value.id, deliveries, deliverKey.value, {
      signal: controller.signal,
    });
    showDeliverModal.value = false;
    deliverKey.value = null;
    await load();
  } catch (failure) {
    if (controller.signal.aborted) return;
    if (isAmbiguous(failure)) {
      deliverError.value = 'No se pudo confirmar la entrega (fallo de red). Puedes reintentarla con el mismo botón sin duplicarla.';
    } else {
      deliverError.value = friendlyOperationsError(failure);
      showDeliverModal.value = false;
      deliverKey.value = null;
      await load();
    }
  } finally {
    deliverSaving.value = false;
  }
}

onMounted(load);
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="request-page">
    <div v-if="loading" class="card empty-state" role="status">
      <div class="empty-icon loading-icon">↻</div>
      <strong>Consultando solicitud</strong>
      <p>Recopilando el detalle de la solicitud de materiales.</p>
    </div>

    <div v-else-if="notFound" class="card empty-state" role="alert">
      <div class="empty-icon error-icon">!</div>
      <strong>Solicitud no encontrada</strong>
      <p>La solicitud ya no está disponible o no tienes acceso a ella.</p>
      <RouterLink class="detail-link" to="/operations">Volver a operaciones</RouterLink>
    </div>

    <div v-else-if="error" class="card empty-state" role="alert">
      <div class="empty-icon error-icon">!</div>
      <strong>No se pudo cargar</strong>
      <p>{{ error }}</p>
    </div>

    <template v-else-if="request">
      <header class="page-header request-header">
        <div>
          <p class="eyebrow">OPERACIONES · SOLICITUD</p>
          <h1>{{ request.code }}</h1>
          <p class="page-description">
            {{ reasonLabel(request.reason) }} · Solicitante: {{ request.requester?.display_name ?? 'Sin datos' }}
          </p>
        </div>
        <div class="header-badges">
          <span class="status-badge" :class="request.status">{{ statusLabel(request.status) }}</span>
          <span class="priority-badge">{{ priorityLabel(request.priority) }}</span>
        </div>
      </header>

      <section class="card info-card">
        <div class="info-grid">
          <div><span class="info-label">Motivo</span><strong>{{ reasonLabel(request.reason) }}</strong></div>
          <div><span class="info-label">Destino</span><strong>{{ request.destination ?? '—' }}</strong></div>
          <div><span class="info-label">Fecha requerida</span><strong>{{ formatDay(request.required_at) }}</strong></div>
          <div><span class="info-label">Planta</span><strong>{{ request.plant?.name ?? '—' }}</strong></div>
          <div><span class="info-label">Creada</span><strong>{{ formatDateTime(request.created_at) }}</strong></div>
          <div class="info-full"><span class="info-label">Observaciones</span><strong>{{ request.observations ?? '—' }}</strong></div>
        </div>
      </section>

      <section class="card progress-card">
        <p class="section-eyebrow">FLUJO</p>
        <ol class="progress-steps">
          <li
            v-for="(step, index) in progressSteps"
            :key="step.key"
            class="progress-step"
            :class="{
              done: progressIndex >= 0 && index < progressIndex,
              current: progressIndex >= 0 && index === progressIndex,
            }"
          >
            <span class="step-dot">{{ index + 1 }}</span>
            <span class="step-label">{{ step.label }}</span>
          </li>
        </ol>
        <p v-if="request.status === 'rejected'" class="terminal-note rejected" role="status">
          Solicitud rechazada por almacén.
        </p>
        <p v-if="request.status === 'cancelled'" class="terminal-note cancelled" role="status">
          Solicitud cancelada. Los materiales preparados se liberaron y no se descontó inventario.
        </p>
      </section>

      <section v-if="actions.length || showCancel || showDeliver" class="card actions-card">
        <p class="section-eyebrow">ACCIONES</p>
        <div class="actions-row">
          <button
            v-for="action in actions"
            :key="action.target"
            class="primary-button"
            type="button"
            @click="askTransition(action)"
          >
            {{ action.label }}
          </button>
          <button v-if="showDeliver" class="primary-button" type="button" @click="openDeliver">
            Entregar materiales
          </button>
          <button v-if="showCancel" class="secondary-button" type="button" @click="askCancel">
            {{ isWarehouse ? 'Cancelar' : 'Cancelar solicitud' }}
          </button>
        </div>
      </section>

      <section class="card lines-card">
        <div class="section-header">
          <div>
            <p class="section-eyebrow">MATERIALES</p>
            <h2>Preparación de materiales</h2>
          </div>
          <span class="visit-count">{{ lines.length }}</span>
        </div>

        <div v-if="!lines.length" class="empty-state">
          <strong>Sin líneas</strong>
          <p>Esta solicitud no tiene materiales asociados.</p>
        </div>

        <div v-for="line in lines" :key="line.id" class="line-block">
          <div class="line-head">
            <div>
              <strong>{{ line.product?.name ?? 'Producto' }}</strong>
              <p class="line-sub">
                {{ productKind(line) }} ·
                Solicitado: {{ line.requested_quantity }} ·
                Preparado: {{ line.prepared_quantity }} ·
                Entregado: {{ line.delivered_quantity }}
              </p>
            </div>
          </div>

          <template v-if="line.product?.tracking_mode === 'serialized'">
            <ul v-if="itemsForLine(line.id).length" class="serial-list">
              <li v-for="item in itemsForLine(line.id)" :key="item.id" class="serial-row">
                <span class="serial-number">{{ item.serial_number ?? item.inventory_item_id }}</span>
                <button
                  v-if="canPrepare"
                  class="link-button"
                  type="button"
                  :disabled="releasingItem === item.id"
                  @click="releaseItem(line, item)"
                >
                  {{ releasingItem === item.id ? 'Quitando…' : 'Quitar' }}
                </button>
              </li>
            </ul>
            <p v-else class="hint">Sin equipos preparados en esta línea.</p>
            <button v-if="canPrepare" class="secondary-button" type="button" @click="openSerialPicker(line)">
              Seleccionar equipos
            </button>
          </template>

          <template v-else>
            <div v-if="canPrepare" class="quantity-row">
              <label>
                <span>Cantidad preparada (0 a {{ line.requested_quantity }})</span>
                <input
                  type="number"
                  min="0"
                  :max="line.requested_quantity"
                  step="any"
                  :value="quantityDraft(line)"
                  :disabled="quantitySaving === line.id"
                  @input="setQuantityDraft(line, $event.target.value)"
                />
              </label>
              <button
                class="secondary-button"
                type="button"
                :disabled="quantitySaving === line.id"
                @click="saveQuantity(line)"
              >
                {{ quantitySaving === line.id ? 'Guardando…' : 'Guardar cantidad' }}
              </button>
            </div>
            <p v-else class="hint">
              Solicitado: {{ line.requested_quantity }} · Preparado: {{ line.prepared_quantity }}
            </p>
            <p class="hint">El inventario se descuenta al confirmar la entrega.</p>
          </template>
        </div>
        <p v-if="quantityError" class="form-error" role="alert">{{ quantityError }}</p>
        <p v-if="serialError && !serialPicker" class="form-error" role="alert">{{ serialError }}</p>
      </section>

      <section class="card timeline-card">
        <p class="section-eyebrow">HISTORIAL</p>
        <h2>Historial</h2>
        <ol v-if="events.length" class="timeline">
          <li v-for="event in events" :key="event.id" class="timeline-row">
            <span class="timeline-dot"></span>
            <div>
              <strong>{{ eventLabel(event.event_type) }}</strong>
              <p class="timeline-meta">
                {{ formatDateTime(event.created_at) }} · Actor: {{ shortActor(event.actor_id) }}
              </p>
            </div>
          </li>
        </ol>
        <p v-else class="hint">Sin eventos registrados.</p>
      </section>
    </template>

    <div v-if="pendingTransition" class="modal-backdrop" @click.self="closeTransitionConfirm">
      <section class="card modal" role="dialog" aria-modal="true" aria-label="Confirmar acción">
        <h2>{{ pendingTransition.label }}</h2>
        <p v-if="pendingTransition.target === 'ready'">
          Revisa la preparación de los materiales antes de marcar la solicitud como lista.
        </p>
        <p v-else>¿Deseas continuar con esta acción?</p>
        <p v-if="transitionError" class="form-error" role="alert">{{ transitionError }}</p>
        <div class="modal-actions">
          <button class="secondary-button" type="button" :disabled="transitionSaving" @click="closeTransitionConfirm">
            Volver
          </button>
          <button class="primary-button" type="submit" :disabled="transitionSaving" @click="confirmTransition">
            {{ transitionSaving ? 'Guardando…' : 'Confirmar' }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="showCancelConfirm" class="modal-backdrop" @click.self="closeCancelConfirm">
      <section class="card modal" role="dialog" aria-modal="true" aria-label="Cancelar solicitud">
        <h2>¿Cancelar esta solicitud?</h2>
        <p>Los materiales preparados se liberarán y no se descontará inventario.</p>
        <p v-if="cancelError" class="form-error" role="alert">{{ cancelError }}</p>
        <div class="modal-actions">
          <button class="secondary-button" type="button" :disabled="cancelSaving" @click="closeCancelConfirm">
            Volver
          </button>
          <button class="primary-button" type="button" :disabled="cancelSaving" @click="confirmCancel">
            {{ cancelSaving ? 'Cancelando…' : 'Confirmar cancelación' }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="serialPicker" class="modal-backdrop" @click.self="closeSerialPicker">
      <section class="card modal modal-wide" role="dialog" aria-modal="true" aria-label="Seleccionar equipos">
        <h2>Seleccionar equipos</h2>
        <p class="hint">Puedes elegir hasta {{ remainingToPrepare(pickerLine() ?? {}) }} equipo(s).</p>
        <div v-if="serialLoading" class="empty-state" role="status">
          <strong>Cargando equipos disponibles…</strong>
        </div>
        <ul v-else-if="serialPicker.items.length" class="serial-list picker-list">
          <li v-for="item in serialPicker.items" :key="item.id" class="serial-row">
            <label class="serial-check">
              <input
                type="checkbox"
                :checked="serialSelected.includes(item.id)"
                :disabled="serialSaving"
                @change="toggleSerial(item.id)"
              />
              <span class="serial-number">{{ item.serial_number }}</span>
            </label>
          </li>
        </ul>
        <p v-else class="hint">No hay equipos disponibles para este producto.</p>
        <p v-if="serialError" class="form-error" role="alert">{{ serialError }}</p>
        <div class="modal-actions">
          <button class="secondary-button" type="button" :disabled="serialSaving" @click="closeSerialPicker">
            Cerrar
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="serialSaving || !serialSelected.length"
            @click="confirmSerialSelection"
          >
            {{ serialSaving ? 'Guardando…' : `Preparar (${serialSelected.length})` }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="showDeliverModal" class="modal-backdrop" @click.self="closeDeliver">
      <section class="card modal modal-wide" role="dialog" aria-modal="true" aria-label="Entregar materiales">
        <h2>Entregar materiales</h2>
        <div v-for="line in lines" :key="line.id" class="line-editor">
          <strong>{{ line.product?.name ?? 'Producto' }}</strong>
          <p class="line-sub">
            Solicitado: {{ line.requested_quantity }} · Preparado: {{ line.prepared_quantity }}
          </p>
          <label>
            <span>Cantidad a entregar (0 a {{ line.prepared_quantity }})</span>
            <input
              v-model="deliverQuantities[line.id]"
              type="number"
              min="0"
              :max="line.prepared_quantity"
              step="any"
              :disabled="deliverSaving"
            />
          </label>
        </div>
        <p v-if="deliverPartial" class="partial-warning" role="note">
          Esta solicitud se cerrará con entrega parcial.
        </p>
        <p v-if="deliverError" class="form-error" role="alert">{{ deliverError }}</p>
        <div class="modal-actions">
          <button class="secondary-button" type="button" :disabled="deliverSaving" @click="closeDeliver">
            Volver
          </button>
          <button class="primary-button" type="button" :disabled="deliverSaving" @click="confirmDeliver">
            {{ deliverSaving ? 'Entregando…' : 'Confirmar entrega' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.request-page {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 18px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.page-description {
  margin-top: 6px;
  color: var(--rdx-text-muted);
}

.header-badges {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
}

.priority-badge {
  display: inline-flex;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.info-card {
  padding: 20px 22px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.info-grid > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.info-full {
  grid-column: 1 / -1;
}

.info-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rdx-text-muted);
}

.info-grid strong {
  color: var(--rdx-text-strong);
  font-size: 14px;
}

.progress-card,
.actions-card,
.lines-card,
.timeline-card {
  padding: 20px 22px;
}

.section-eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--rdx-text-muted);
}

.progress-steps {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.progress-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--rdx-border);
  border-radius: 10px;
  color: var(--rdx-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.step-dot {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--rdx-neutral-soft);
  font-size: 12px;
}

.progress-step.done {
  border-color: var(--rdx-success);
  color: var(--rdx-success);
}

.progress-step.done .step-dot {
  background: var(--rdx-success-soft);
}

.progress-step.current {
  border-color: var(--rdx-accent);
  color: var(--rdx-accent);
}

.progress-step.current .step-dot {
  background: var(--rdx-primary-soft);
}

.terminal-note {
  margin: 12px 0 0;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
}

.terminal-note.rejected,
.terminal-note.cancelled {
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.primary-button {
  padding: 10px 18px;
  border: none;
  border-radius: 10px;
  background: var(--rdx-accent);
  color: #fff;
  font-size: 14px;
  font-weight: 700;
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

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.lines-card .section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--rdx-border);
}

.lines-card h2,
.timeline-card h2 {
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

.line-block {
  display: grid;
  gap: 10px;
  padding: 16px 0;
  border-bottom: 1px solid var(--rdx-border);
}

.line-block:last-child {
  border-bottom: 0;
}

.line-sub {
  margin: 4px 0 0;
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.serial-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.serial-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--rdx-border);
  border-radius: 8px;
}

.serial-number {
  font-weight: 700;
  color: var(--rdx-text-strong);
  font-size: 13px;
}

.serial-check {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.link-button {
  border: 0;
  background: none;
  color: var(--rdx-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.quantity-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
}

.quantity-row label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--rdx-text-muted);
}

.quantity-row input {
  padding: 9px 12px;
  border: 1px solid var(--rdx-border);
  border-radius: 9px;
  background: var(--rdx-surface);
  color: var(--rdx-text-strong);
  font-size: 13px;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--rdx-text-muted);
}

.timeline {
  display: grid;
  gap: 12px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.timeline-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.timeline-dot {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  margin-top: 4px;
  border-radius: 50%;
  background: var(--rdx-accent);
}

.timeline-meta {
  margin: 2px 0 0;
  color: var(--rdx-text-muted);
  font-size: 12px;
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

.status-badge.ready,
.status-badge.delivered {
  background: var(--rdx-success-soft);
  color: var(--rdx-success);
}

.status-badge.preparing,
.status-badge.received {
  background: var(--rdx-primary-soft);
  color: var(--rdx-accent);
}

.status-badge.cancelled,
.status-badge.rejected {
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
}

.detail-link {
  color: var(--rdx-accent);
  font-weight: 700;
  white-space: nowrap;
}

.empty-state {
  display: flex;
  min-height: 200px;
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

.loading-icon {
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
}

.error-icon {
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
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

.modal-wide {
  max-width: 720px;
}

.modal h2 {
  margin: 0 0 12px;
  font-size: 18px;
}

.line-editor {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--rdx-border);
  border-radius: 10px;
  margin-bottom: 10px;
}

.line-editor label {
  display: grid;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
}

.line-editor input {
  padding: 10px 12px;
  border-radius: 8px;
  font: inherit;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 12px;
}

.form-error {
  color: var(--rdx-danger);
  font-size: 13px;
}

.partial-warning {
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
  font-size: 13px;
  font-weight: 600;
}

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
  }

  .info-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .progress-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .info-grid {
    grid-template-columns: 1fr;
  }

  .progress-steps {
    grid-template-columns: 1fr;
  }
}
</style>
