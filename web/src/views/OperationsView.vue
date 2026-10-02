<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import SearchableSelect from '../components/SearchableSelect.vue';
import { apiFetch, getMyProfile } from '../services/api.js';
import { createRequest, listClients, listProducts, listRequests } from '../services/operations.js';
import { buildCreatePayload, canCreateRequest, destinationDisplay, destinationTypeLabels, destinationTypes, filterPickerProducts, pickerAvailabilityText, priorityLabel, productCategoryLabel, productCategoryOptions, reasonAllowsPlant, reasonLabel, reasonLabels, requestPriorities, requestReasons, statusLabel } from '../utils/operations.js';

const router = useRouter();

const requests = ref([]);
const products = ref([]);
const plants = ref([]);
const plantNames = ref({});
const clients = ref([]);
const clientsLoaded = ref(false);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const myRole = ref(null);

const statusFilter = ref('all');
const priorityFilter = ref('all');
const reasonFilter = ref('all');
const plantFilter = ref('all');
const dateFrom = ref('');
const dateTo = ref('');

const controller = new AbortController();

const showForm = ref(false);
const formSaving = ref(false);
const formError = ref('');

function emptyLine() {
  return { product_id: '', requested_quantity: '1', observations: '' };
}

function emptyForm() {
  return {
    reason: 'maintenance',
    priority: 'normal',
    plant_id: '',
    destination_type: 'client',
    destination_client_id: '',
    destination: '',
    required_at: '',
    observations: '',
    // Sin línea vacía inicial: cada línea nace al elegir un material.
    lines: [],
  };
}

const form = ref(emptyForm());
const clientSelect = ref(null);

// Planta solo para maintenance/warranty/replacement: al salir de esos
// motivos se limpia plant_id de inmediato.
watch(() => form.value.reason, reason => {
  if (!reasonAllowsPlant(reason)) form.value.plant_id = '';
});

// Tipo de destino excluyente: al pasar a Otro se limpia el cliente.
watch(() => form.value.destination_type, type => {
  if (type !== 'client') {
    form.value.destination_client_id = '';
    clientSelect.value?.close();
  }
});

const canCreate = computed(() => canCreateRequest(myRole.value));

const kpis = computed(() => {
  let requested = 0;
  let preparing = 0;
  let ready = 0;
  let delivered = 0;
  for (const request of requests.value) {
    if (request.status === 'requested' || request.status === 'received') requested += 1;
    else if (request.status === 'preparing') preparing += 1;
    else if (request.status === 'ready') ready += 1;
    else if (request.status === 'delivered') delivered += 1;
  }
  return { requested, preparing, ready, delivered };
});

const plantOptions = computed(() => plants.value.map(plant => ({
  id: plant.id,
  name: plant.name ?? plant.id,
})));

const clientOptions = computed(() => clients.value.map(client => ({
  id: client.id,
  name: client.name ?? client.id,
  phone: client.phone ?? null,
  email: client.email ?? null,
})));

function clientPrimaryText(client) {
  return client.name;
}

function clientSecondaryText(client) {
  return [client.phone, client.email].filter(Boolean).join(' · ');
}

const filtered = computed(() => requests.value.filter(request => {
  if (statusFilter.value !== 'all' && request.status !== statusFilter.value) return false;
  if (priorityFilter.value !== 'all' && request.priority !== priorityFilter.value) return false;
  if (reasonFilter.value !== 'all' && request.reason !== reasonFilter.value) return false;
  if (plantFilter.value !== 'all' && request.plant_id !== plantFilter.value) return false;
  const day = request.created_at ? String(request.created_at).slice(0, 10) : '';
  if (dateFrom.value && (!day || day < dateFrom.value)) return false;
  if (dateTo.value && (!day || day > dateTo.value)) return false;
  return true;
}));

function requesterName(request) {
  return request.requester?.display_name?.trim() || 'Sin datos';
}

function destinationPrimary(request) {
  return destinationDisplay(request).primary;
}

function destinationSecondary(request) {
  return destinationDisplay(request).secondary;
}

function plantName(plantId) {
  if (!plantId) return '—';
  return plantNames.value[plantId] ?? requestPlantName(plantId);
}

function requestPlantName(plantId) {
  const found = requests.value.find(request => request.plant_id === plantId);
  return found?.plant?.name ?? 'Sin datos';
}

function availabilityText(product) {
  const availability = product.availability;
  if (!availability) return 'Disponibilidad no disponible';
  if (product.tracking_mode === 'serialized') {
    return `Disponibles: ${availability.available_count ?? '—'}`;
  }
  return `Disponible: ${availability.available ?? '—'}`;
}

function productDetail(product) {
  const maker = [product.manufacturer, product.model].filter(Boolean).join(' · ');
  const kind = product.tracking_mode === 'serialized' ? 'Serializado' : 'Por cantidad';
  return `${product.name} · ${maker ? `${maker} · ` : ''}${kind} · ${availabilityText(product)}`;
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

function formatDay(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short' }).format(date);
}

function openCreate() {
  form.value = emptyForm();
  formError.value = '';
  formSaving.value = false;
  showForm.value = true;
  void loadClients();
}

async function loadClients() {
  if (clientsLoaded.value) return;
  try {
    const data = await listClients({ signal: controller.signal });
    clients.value = Array.isArray(data) ? data : [];
    clientsLoaded.value = true;
  } catch {
    clients.value = [];
  }
}

function closeForm() {
  if (formSaving.value) return;
  showForm.value = false;
  formError.value = '';
}

function addLine() {
  form.value.lines.push(emptyLine());
}

function removeLine(index) {
  form.value.lines.splice(index, 1);
}

// ---- Selector de materiales (picker con búsqueda, sin <select> masivo) ----

const showPicker = ref(false);
const pickerTarget = ref(null);
const pickerSearch = ref('');
const pickerCategory = ref('all');
const pickerLimit = ref(10);
const pickerSearchInput = ref(null);

const pickerCategoryOptions = computed(() => productCategoryOptions);

const pickerExcludeIds = computed(() => {
  const current = pickerTarget.value !== null
    ? form.value.lines[pickerTarget.value]?.product_id
    : '';
  return form.value.lines
    .map(line => line.product_id)
    .filter(id => typeof id === 'string' && id !== '' && id !== current);
});

const pickerHasCriteria = computed(() => (
  pickerSearch.value.trim() !== ''
  || pickerCategory.value !== 'all'
));

const pickerResults = computed(() => {
  if (!pickerHasCriteria.value) return { results: [], total: 0 };
  return filterPickerProducts(products.value, {
    search: pickerSearch.value,
    category: pickerCategory.value,
    excludeIds: pickerExcludeIds.value,
    limit: pickerLimit.value,
  });
});

const pickerEmptyMessage = computed(() => (
  pickerCategory.value !== 'all'
    ? 'No hay productos disponibles en esta categoría.'
    : 'Sin resultados para los filtros indicados.'
));

function productById(productId) {
  return products.value.find(product => product.id === productId) ?? null;
}

function openPickerForNew() {
  pickerTarget.value = null;
  pickerSearch.value = '';
  pickerCategory.value = 'all';
  pickerLimit.value = 10;
  showPicker.value = true;
  void nextTick(() => pickerSearchInput.value?.focus());
}

function openPickerForLine(index) {
  pickerTarget.value = index;
  pickerSearch.value = '';
  pickerCategory.value = 'all';
  pickerLimit.value = 10;
  showPicker.value = true;
  void nextTick(() => pickerSearchInput.value?.focus());
}

function closePicker() {
  showPicker.value = false;
  pickerTarget.value = null;
}

function showMorePickerResults() {
  pickerLimit.value += 10;
}

function selectPickerProduct(productId) {
  if (pickerTarget.value === null) {
    form.value.lines.push({ ...emptyLine(), product_id: productId });
  } else {
    form.value.lines[pickerTarget.value].product_id = productId;
  }
  closePicker();
}

async function saveForm() {
  if (formSaving.value) return;
  formError.value = '';
  const raw = {
    reason: form.value.reason,
    priority: form.value.priority,
    plant_id: form.value.plant_id || null,
    destination_type: form.value.destination_type,
    destination_client_id: form.value.destination_client_id || null,
    destination: form.value.destination,
    required_at: form.value.required_at ? toApiDateTime(form.value.required_at) : null,
    observations: form.value.observations,
    lines: form.value.lines,
  };
  const { payload, error: validationError } = buildCreatePayload(raw);
  if (validationError) {
    formError.value = validationError;
    return;
  }
  formSaving.value = true;
  try {
    const created = await createRequest(payload, { signal: controller.signal });
    formSaving.value = false;
    closeForm();
    if (created?.id) {
      await router.push(`/operations/${created.id}`);
      return;
    }
    notice.value = `Solicitud ${created?.code ?? ''} creada correctamente.`;
    await load();
  } catch (failure) {
    if (!controller.signal.aborted) {
      if (failure?.status === 403) formError.value = 'No tienes permiso para crear solicitudes.';
      else if (failure?.status === 400) formError.value = 'Revisa los datos ingresados e inténtalo de nuevo.';
      else formError.value = 'No se pudo crear la solicitud. Comprueba la conexión y vuelve a intentarlo.';
    }
    formSaving.value = false;
  }
}

function toApiDateTime(value) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const me = await getMyProfile();
    myRole.value = me?.profile?.role ?? null;
    const [requestData, productData, plantData] = await Promise.all([
      listRequests({}, { signal: controller.signal }),
      listProducts({ signal: controller.signal }).catch(() => []),
      apiFetch('/plants', { signal: controller.signal }).catch(() => []),
    ]);
    if (!Array.isArray(requestData)) throw new Error('Respuesta inválida');
    requests.value = requestData;
    products.value = Array.isArray(productData) ? productData : [];
    const plantList = Array.isArray(plantData) ? plantData : (plantData?.plants ?? plantData?.data ?? []);
    plants.value = Array.isArray(plantList) ? plantList : [];
    plantNames.value = Object.fromEntries(
      plants.value.map(plant => [plant.id, plant.name ?? plant.id]),
    );
  } catch (failure) {
    if (!controller.signal.aborted) {
      error.value = 'No se pudieron cargar las solicitudes. Comprueba la conexión y vuelve a intentarlo.';
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="operations-page">
    <header class="page-header operations-header">
      <div>
        <p class="eyebrow">RDX SOLAR MONITOR</p>
        <h1>Solicitudes de materiales</h1>
        <p class="page-description">
          Solicitudes de materiales y preparación de almacén.
        </p>
      </div>
      <button v-if="canCreate" class="primary-button" type="button" @click="openCreate">Nueva solicitud</button>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <section class="kpi-grid">
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">SOLICITADAS</span></div>
        <strong class="kpi-value">{{ kpis.requested }}</strong>
        <span class="kpi-state">Solicitadas y recibidas</span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">EN PREPARACIÓN</span></div>
        <strong class="kpi-value">{{ kpis.preparing }}</strong>
        <span class="kpi-state">En preparación de almacén</span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">LISTAS PARA ENTREGA</span></div>
        <strong class="kpi-value">{{ kpis.ready }}</strong>
        <span class="kpi-state">Listas para entrega</span>
      </article>
      <article class="card kpi-card">
        <div class="kpi-top"><span class="kpi-label">ENTREGADAS</span></div>
        <strong class="kpi-value">{{ kpis.delivered }}</strong>
        <span class="kpi-state">Materiales entregados</span>
      </article>
    </section>

    <section class="card filters-card">
      <div class="filters-grid">
        <label class="filter-field">
          <span>Estado</span>
          <select v-model="statusFilter">
            <option value="all">Todos</option>
            <option value="requested">Solicitada</option>
            <option value="received">Recibida</option>
            <option value="preparing">En preparación</option>
            <option value="ready">Lista para entrega</option>
            <option value="delivered">Entregada</option>
            <option value="rejected">Rechazada</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </label>
        <label class="filter-field">
          <span>Prioridad</span>
          <select v-model="priorityFilter">
            <option value="all">Todas</option>
            <option value="low">Baja</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </select>
        </label>
        <label class="filter-field">
          <span>Motivo</span>
          <select v-model="reasonFilter">
            <option value="all">Todos</option>
            <option v-for="reason in requestReasons" :key="reason" :value="reason">
              {{ reasonLabel(reason) }}
            </option>
          </select>
        </label>
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
          <p class="section-eyebrow">SOLICITUDES</p>
          <h2>Listado de solicitudes</h2>
        </div>
        <span class="visit-count">{{ filtered.length }}</span>
      </div>

      <div v-if="loading" class="empty-state" role="status">
        <div class="empty-icon loading-icon">↻</div>
        <strong>Consultando solicitudes</strong>
        <p>Recopilando las solicitudes de materiales.</p>
      </div>

      <div v-else-if="error" class="empty-state" role="alert">
        <div class="empty-icon error-icon">!</div>
        <strong>No se pudo cargar</strong>
        <p>{{ error }}</p>
      </div>

      <div v-else-if="!filtered.length" class="empty-state">
        <div class="empty-icon success-icon">✓</div>
        <strong>Sin solicitudes</strong>
        <p>No hay solicitudes de materiales para los filtros seleccionados.</p>
      </div>

      <div v-else class="table-wrapper">
        <table class="visit-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Solicitante</th>
              <th>Motivo</th>
              <th>Prioridad</th>
              <th>Estado</th>
              <th>Destino</th>
              <th>Requerido para</th>
              <th>Creado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="request in filtered" :key="request.id">
              <td class="plant-name">{{ request.code }}</td>
              <td>{{ requesterName(request) }}</td>
              <td>{{ reasonLabel(request.reason) }}</td>
              <td>{{ priorityLabel(request.priority) }}</td>
              <td>
                <span class="status-badge" :class="request.status">{{ statusLabel(request.status) }}</span>
              </td>
              <td>
                <div>{{ destinationPrimary(request) }}</div>
                <div v-if="destinationSecondary(request)" class="destination-secondary">
                  {{ destinationSecondary(request) }}
                </div>
              </td>
              <td class="date-cell">{{ formatDay(request.required_at) }}</td>
              <td class="date-cell">{{ formatDate(request.created_at) }}</td>
              <td>
                <RouterLink class="detail-link" :to="`/operations/${request.id}`">Ver detalle</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="showForm" class="modal-backdrop" @click.self="closeForm">
      <section class="card modal modal-wide" role="dialog" aria-modal="true" aria-label="Nueva solicitud">
        <h2>Nueva solicitud</h2>
        <form @submit.prevent="saveForm">
          <fieldset>
            <legend>Solicitud</legend>
            <label for="request-reason">Motivo *</label>
            <select id="request-reason" v-model="form.reason" :disabled="formSaving">
              <option v-for="reason in requestReasons" :key="reason" :value="reason">
                {{ reasonLabels[reason] }}
              </option>
            </select>
            <label for="request-priority">Prioridad *</label>
            <select id="request-priority" v-model="form.priority" :disabled="formSaving">
              <option v-for="priority in requestPriorities" :key="priority" :value="priority">
                {{ priorityLabel(priority) }}
              </option>
            </select>
            <label for="request-plant" v-if="reasonAllowsPlant(form.reason)">Planta (opcional)</label>
            <select v-if="reasonAllowsPlant(form.reason)" id="request-plant" v-model="form.plant_id" :disabled="formSaving">
              <option value="">Sin planta específica</option>
              <option v-for="option in plantOptions" :key="option.id" :value="option.id">
                {{ option.name }}
              </option>
            </select>
            <label for="request-destination-type">Tipo de destino *</label>
            <select id="request-destination-type" v-model="form.destination_type" :disabled="formSaving">
              <option v-for="type in destinationTypes" :key="type" :value="type">
                {{ destinationTypeLabels[type] }}
              </option>
            </select>
            <template v-if="form.destination_type === 'client'">
              <label>Cliente *</label>
              <SearchableSelect
                ref="clientSelect"
                v-model="form.destination_client_id"
                :options="clientOptions"
                :search-fields="['name', 'phone', 'email']"
                :primary-text="clientPrimaryText"
                :secondary-text="clientSecondaryText"
                placeholder="Buscar cliente por nombre, teléfono o correo"
                aria-label="Cliente"
                :max-results="8"
                :disabled="formSaving"
                required
              />
              <label for="request-destination">Lugar de entrega / referencia (opcional)</label>
              <input id="request-destination" v-model="form.destination" type="text" maxlength="400" :disabled="formSaving" />
            </template>
            <template v-else>
              <label for="request-destination">Destino *</label>
              <input id="request-destination" v-model="form.destination" type="text" maxlength="400" :disabled="formSaving" />
            </template>
            <label for="request-required">Fecha requerida</label>
            <input id="request-required" v-model="form.required_at" type="datetime-local" :disabled="formSaving" />
            <label for="request-observations">Observaciones</label>
            <textarea id="request-observations" v-model="form.observations" rows="2" :disabled="formSaving"></textarea>
          </fieldset>
          <fieldset>
            <legend>Materiales</legend>
            <div v-for="(line, index) in form.lines" :key="index" class="line-editor">
              <div class="line-product">
                <div v-if="productById(line.product_id)">
                  <strong>{{ productById(line.product_id).name }}</strong>
                  <p class="line-sub">{{ productDetail(productById(line.product_id)) }}</p>
                </div>
                <div v-else>
                  <strong>Sin material seleccionado</strong>
                  <p class="line-sub">Elige un material del catálogo para esta línea.</p>
                </div>
                <button class="secondary-button" type="button" :disabled="formSaving" @click="openPickerForLine(index)">
                  {{ line.product_id ? 'Cambiar material' : 'Seleccionar material' }}
                </button>
              </div>
              <label>
                <span>Cantidad *</span>
                <input v-model="line.requested_quantity" type="number" min="0" step="any" :disabled="formSaving" />
              </label>
              <label>
                <span>Observación</span>
                <input v-model="line.observations" type="text" maxlength="4000" :disabled="formSaving" />
              </label>
              <button class="secondary-button line-remove" type="button" :disabled="formSaving" @click="removeLine(index)">
                Eliminar
              </button>
            </div>
            <p v-if="!form.lines.length" class="hint">Sin materiales. Agrega el primero con + Agregar material.</p>
            <button class="secondary-button" type="button" :disabled="formSaving" @click="openPickerForNew">
              + Agregar material
            </button>
            <p class="hint">La disponibilidad es informativa. La validación física final ocurre al entregar.</p>
          </fieldset>
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <div class="modal-actions">
            <button class="secondary-button" type="button" :disabled="formSaving" @click="closeForm">Cancelar</button>
            <button class="primary-button" type="submit" :disabled="formSaving">
              {{ formSaving ? 'Guardando…' : 'Crear solicitud' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="showPicker" class="modal-backdrop" @click.self="closePicker">
      <section class="card modal modal-wide" role="dialog" aria-modal="true" aria-label="Seleccionar material">
        <h2>Seleccionar material</h2>
        <div class="picker-filters">
          <label class="picker-search">
            <span>Buscar por nombre, fabricante o modelo</span>
            <input ref="pickerSearchInput" v-model="pickerSearch" type="search" placeholder="Buscar por nombre, fabricante o modelo" autofocus />
          </label>
          <label>
            <span>Categoría</span>
            <select v-model="pickerCategory">
              <option value="all">Todos</option>
              <option v-for="option in pickerCategoryOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
        <p v-if="pickerHasCriteria" class="hint" role="status">
          {{ pickerResults.total }} resultado(s). La disponibilidad es informativa.
        </p>
        <p v-else class="picker-initial" role="status">
          Escribe para buscar un material o utiliza los filtros.
        </p>
        <ul v-if="pickerResults.results.length" class="picker-list">
          <li v-for="product in pickerResults.results" :key="product.id" class="picker-row">
            <div>
              <strong>{{ product.name }}</strong>
              <p class="line-sub">{{ [product.manufacturer, product.model].filter(Boolean).join(' · ') || 'Sin fabricante/modelo' }}</p>
              <p class="line-sub">
                {{ productCategoryLabel(product.category) }} · {{ pickerAvailabilityText(product) }}
              </p>
            </div>
            <button class="secondary-button" type="button" @click="selectPickerProduct(product.id)">
              Seleccionar
            </button>
          </li>
        </ul>
        <p v-else-if="pickerHasCriteria" class="hint">{{ pickerEmptyMessage }}</p>
        <button
          v-if="pickerResults.total > pickerResults.results.length"
          class="secondary-button"
          type="button"
          @click="showMorePickerResults"
        >
          Mostrar más ({{ pickerResults.total - pickerResults.results.length }} restantes)
        </button>
        <div class="modal-actions">
          <button class="secondary-button" type="button" @click="closePicker">Cerrar</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.operations-page {
  width: 100%;
  min-width: 0;
}

.operations-header {
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

.notice {
  margin: 0 0 18px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--rdx-success-soft);
  color: var(--rdx-success);
  font-size: 13px;
  font-weight: 600;
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

.filters-card {
  padding: 18px 22px;
  margin-bottom: 18px;
}

.filters-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
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

.destination-secondary {
  margin-top: 2px;
  font-size: 11px;
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

.modal-wide {
  max-width: 720px;
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

.line-editor {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--rdx-border);
  border-radius: 10px;
}

.line-editor label {
  display: grid;
  gap: 4px;
}

.line-remove {
  justify-self: end;
}

.line-product {
  display: grid;
  gap: 8px;
}

.line-product .secondary-button {
  justify-self: start;
}

.picker-filters {
  display: grid;
  gap: 8px;
  margin-bottom: 8px;
}

.picker-filters label {
  display: grid;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
}

.picker-list {
  display: grid;
  gap: 8px;
  margin: 12px 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
}

.picker-initial {
  margin: 18px 0;
  padding: 22px 14px;
  border: 1px dashed var(--rdx-border);
  border-radius: 10px;
  color: var(--rdx-text-muted);
  font-size: 13px;
  text-align: center;
}

.picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--rdx-border);
  border-radius: 10px;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--rdx-text-muted);
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
  .operations-header {
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
