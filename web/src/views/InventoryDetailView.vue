<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch, getMyProfile } from '../services/api.js';
import { listClients } from '../services/clients.js';
import {
  createQuantityInventoryMovement,
  createSerializedInventoryItem,
  getInventoryProduct,
  listInventoryItems,
  listInventoryMovements,
  transitionSerializedInventoryItem,
  updateInventoryProduct,
} from '../services/inventory.js';

const categories = {
  inverter: 'Inversor', solar_panel: 'Panel solar', smart_meter: 'Smart meter',
  battery: 'Batería', datalogger: 'Datalogger', protection: 'Protección',
  structure: 'Estructura', cable: 'Cable', other: 'Otro',
};
const statusLabels = {
  available: 'Disponible', assigned: 'Asignado', installed: 'Instalado',
  sold: 'Vendido', written_off: 'Baja',
};
const movementLabels = {
  in: 'Entrada', assign: 'Asignación', install: 'Instalación', return: 'Devolución',
  sell: 'Venta', write_off: 'Baja', adjust_in: 'Ajuste entrada', adjust_out: 'Ajuste salida',
};
const transitionLabels = {
  assign: 'Asignar', install: 'Instalar', return: 'Devolver', sell: 'Vender', write_off: 'Dar de baja',
};
const allowedActions = {
  available: ['assign', 'sell', 'write_off'],
  assigned: ['install', 'return', 'sell', 'write_off'],
  installed: ['write_off'], sold: [], written_off: [],
};

const route = useRoute();
let controller = new AbortController();
let itemRequest = 0;
const detail = ref(null);
const items = ref([]);
const movements = ref([]);
const plants = ref([]);
const clients = ref([]);
const devices = ref([]);
const role = ref(null);
const loading = ref(true);
const error = ref('');
const notFound = ref(false);
const notice = ref('');
const refreshError = ref('');
const itemsLoading = ref(false);
const itemsError = ref('');

const product = computed(() => detail.value?.product ?? null);
const summary = computed(() => detail.value?.summary ?? {});
const canWrite = computed(() => role.value === 'rdx_admin');
const isSerialized = computed(() => product.value?.tracking_mode === 'serialized');
const plantsById = computed(() => Object.fromEntries(plants.value.map(row => [row.id, row.name ?? row.id])));
const clientsById = computed(() => Object.fromEntries(clients.value.map(row => [row.id, row.name ?? row.id])));
const devicesById = computed(() => Object.fromEntries(devices.value.map(row => [row.id, row.name || row.serial_number || row.id])));

function formatDecimal(value) {
  const text = String(value ?? '').trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return '—';
  return `${match[1] === '-' ? '-' : ''}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${match[3] ? `,${match[3]}` : ''}`;
}
function formatDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function categoryLabel(value) { return categories[value] ?? value ?? '—'; }
function statusLabel(value) { return statusLabels[value] ?? value ?? '—'; }
function movementLabel(value) { return movementLabels[value] ?? value ?? '—'; }
function plantName(id) { return id ? plantsById.value[id] ?? `Planta ${String(id).slice(0, 8)}` : '—'; }
function clientName(id) { return id ? clientsById.value[id] ?? 'Cliente asignado' : '—'; }
function deviceName(id) { return id ? devicesById.value[id] ?? `Dispositivo ${String(id).slice(0, 8)}` : '—'; }
function manufacturerModel(value) { return [value?.manufacturer, value?.model].filter(Boolean).join(' · ') || '—'; }

function plantsForClient(clientId) {
  if (!clientId) return [];
  const client = clients.value.find(entry => entry.id === clientId);
  const allowed = new Set(Array.isArray(client?.plant_ids) ? client.plant_ids : []);
  return plants.value.filter(plant => allowed.has(plant.id));
}

const itemFilters = ref({ status: '', search: '', clientId: '', plantId: '' });
const itemAvailablePlants = computed(() => canWrite.value
  ? plantsForClient(itemFilters.value.clientId)
  : plants.value);
watch(() => itemFilters.value.clientId, () => { itemFilters.value.plantId = null; });

async function loadItems() {
  if (!isSerialized.value) { items.value = []; itemsError.value = ''; return; }
  const request = ++itemRequest;
  const signal = controller.signal;
  const params = Object.fromEntries(Object.entries(itemFilters.value).filter(([, value]) => value));
  itemsLoading.value = true;
  itemsError.value = '';
  try {
    const data = await listInventoryItems(route.params.id, params, { signal });
    if (!signal.aborted && request === itemRequest) {
      items.value = Array.isArray(data) ? data : [];
    }
  } catch {
    if (!signal.aborted && request === itemRequest) {
      itemsError.value = 'No se pudieron cargar las unidades. Inténtalo nuevamente.';
    }
  } finally {
    if (request === itemRequest) itemsLoading.value = false;
  }
}

async function loadInventoryData(signal = controller.signal) {
  const request = ++itemRequest;
  const [productData, movementData] = await Promise.all([
    getInventoryProduct(route.params.id, { signal }),
    listInventoryMovements({ productId: route.params.id }, { signal }),
  ]);
  let itemData = [];
  if (productData?.product?.tracking_mode === 'serialized') {
    itemsLoading.value = true;
    const params = Object.fromEntries(Object.entries(itemFilters.value).filter(([, value]) => value));
    try {
      itemData = await listInventoryItems(route.params.id, params, { signal });
    } finally {
      if (request === itemRequest) itemsLoading.value = false;
    }
  }
  if (signal.aborted || request !== itemRequest) return;
  detail.value = productData;
  movements.value = Array.isArray(movementData) ? movementData : [];
  items.value = Array.isArray(itemData) ? itemData : [];
  itemsError.value = '';
  refreshError.value = '';
}

async function load() {
  controller.abort();
  const requestController = new AbortController();
  controller = requestController;
  loading.value = true;
  error.value = '';
  notFound.value = false;
  detail.value = null;
  items.value = [];
  movements.value = [];
  plants.value = [];
  clients.value = [];
  devices.value = [];
  notice.value = '';
  refreshError.value = '';
  try {
    const me = await getMyProfile();
    if (requestController.signal.aborted) return;
    role.value = me?.profile?.role ?? null;
    const supporting = [apiFetch('/plants', { signal: requestController.signal }).catch(() => [])];
    if (role.value === 'rdx_admin') {
      supporting.push(listClients({
        includePlantIds: true,
        signal: requestController.signal,
      }).catch(() => []));
      supporting.push(apiFetch('/devices', { signal: requestController.signal }).catch(() => []));
    }
    const results = await Promise.all([loadInventoryData(requestController.signal), ...supporting]);
    if (requestController.signal.aborted) return;
    plants.value = Array.isArray(results[1]) ? results[1] : [];
    if (role.value === 'rdx_admin') {
      clients.value = Array.isArray(results[2]) ? results[2] : [];
      devices.value = Array.isArray(results[3]) ? results[3] : [];
    }
  } catch (failure) {
    if (requestController.signal.aborted) return;
    if (failure?.status === 404) notFound.value = true;
    else error.value = 'No se pudo cargar el detalle de inventario.';
  } finally {
    if (!requestController.signal.aborted) loading.value = false;
  }
}

async function refresh() {
  await loadInventoryData();
}

async function refreshAfterWrite(successMessage) {
  notice.value = successMessage;
  try {
    await refresh();
  } catch {
    refreshError.value = 'La operación se guardó, pero no se pudo actualizar la vista. Recarga la página.';
  }
}

function actionError(failure) {
  if (failure?.status === 409 && /stock insuficiente/i.test(failure?.detail ?? '')) {
    return 'No hay stock suficiente para realizar este movimiento.';
  }
  if (failure?.status === 409) return failure?.detail || 'La operación ya no es válida para el estado actual.';
  if (failure?.status === 400) return failure?.detail || 'Revisa los datos ingresados.';
  if (failure?.status === 403) return 'No tienes permiso para realizar esta acción.';
  if (failure?.status === 404) return 'El registro ya no está disponible.';
  return 'No se pudo completar la operación. Inténtalo nuevamente.';
}

const showEdit = ref(false);
const editSaving = ref(false);
const editError = ref('');
const editForm = ref({});

function openEdit() {
  editForm.value = {
    name: product.value.name ?? '', category: product.value.category,
    manufacturer: product.value.manufacturer ?? '', model: product.value.model ?? '',
    unit: product.value.unit ?? '', tracking_mode: product.value.tracking_mode,
    reorder_level: String(product.value.reorder_level ?? '0'), active: product.value.active,
  };
  editError.value = '';
  showEdit.value = true;
}
function closeEdit() { if (!editSaving.value) showEdit.value = false; }
function validDecimal(value, allowZero = true) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  if (!allowZero && !/[1-9]/.test(text)) return null;
  return text;
}
async function saveEdit() {
  if (editSaving.value) return;
  editError.value = '';
  const name = editForm.value.name.trim();
  const unit = editForm.value.unit.trim();
  const reorder = validDecimal(editForm.value.reorder_level);
  if (!name || !unit || reorder === null) { editError.value = 'Revisa los campos obligatorios.'; return; }
  editSaving.value = true;
  try {
    await updateInventoryProduct(product.value.id, {
      name, category: editForm.value.category,
      manufacturer: editForm.value.manufacturer.trim() || null,
      model: editForm.value.model.trim() || null,
      unit, tracking_mode: editForm.value.tracking_mode,
      reorder_level: reorder, active: editForm.value.active,
    }, { signal: controller.signal });
    showEdit.value = false;
    await refreshAfterWrite('Producto actualizado correctamente.');
  } catch (failure) { editError.value = actionError(failure); }
  finally { editSaving.value = false; }
}

const showNewItem = ref(false);
const itemSaving = ref(false);
const itemError = ref('');
const itemForm = ref({ serial_number: '', notes: '' });
function openNewItem() { itemForm.value = { serial_number: '', notes: '' }; itemError.value = ''; showNewItem.value = true; }
function closeNewItem() { if (!itemSaving.value) showNewItem.value = false; }
async function saveNewItem() {
  if (itemSaving.value) return;
  const serial = itemForm.value.serial_number.trim();
  if (!serial) { itemError.value = 'El número de serie es obligatorio.'; return; }
  itemSaving.value = true; itemError.value = '';
  try {
    await createSerializedInventoryItem(product.value.id, {
      serial_number: serial, notes: itemForm.value.notes.trim() || null,
    }, { signal: controller.signal });
    showNewItem.value = false;
    await refreshAfterWrite('Unidad registrada correctamente.');
  } catch (failure) { itemError.value = actionError(failure); }
  finally { itemSaving.value = false; }
}

const transitionItem = ref(null);
const transitionType = ref('');
const transitionSaving = ref(false);
const transitionError = ref('');
const transitionForm = ref({ client_id: '', plant_id: '', device_id: '', notes: '', use_context: false });
const installDevices = computed(() => devices.value.filter(device => device.plant_id === transitionItem.value?.plant_id));
const transitionAvailablePlants = computed(() => plantsForClient(transitionForm.value.client_id));
watch(() => transitionForm.value.client_id, () => { transitionForm.value.plant_id = null; });

function openTransition(item, type) {
  transitionItem.value = item; transitionType.value = type; transitionError.value = '';
  transitionForm.value = { client_id: '', plant_id: '', device_id: '', notes: '', use_context: false };
}
function closeTransition() { if (!transitionSaving.value) transitionItem.value = null; }
function transitionDescription() {
  if (transitionType.value === 'return') return 'Esta unidad volverá a estar disponible en inventario.';
  if (transitionType.value === 'write_off') return 'La unidad quedará fuera del stock físico.';
  if (transitionType.value === 'sell') return 'Confirma la venta de esta unidad.';
  return '';
}
async function applyTransition() {
  if (!transitionItem.value || transitionSaving.value) return;
  const payload = { movement_type: transitionType.value, notes: transitionForm.value.notes.trim() || null };
  if (transitionType.value === 'assign') {
    if (!transitionForm.value.client_id || !transitionForm.value.plant_id) {
      transitionError.value = 'Selecciona cliente y planta.'; return;
    }
    payload.client_id = transitionForm.value.client_id; payload.plant_id = transitionForm.value.plant_id;
  }
  if (transitionType.value === 'install' && transitionForm.value.device_id) {
    payload.device_id = transitionForm.value.device_id;
  }
  if (transitionType.value === 'sell' && transitionItem.value.status === 'available'
    && transitionForm.value.use_context) {
    if (!transitionForm.value.client_id || !transitionForm.value.plant_id) {
      transitionError.value = 'Para agregar contexto selecciona cliente y planta.'; return;
    }
    payload.client_id = transitionForm.value.client_id; payload.plant_id = transitionForm.value.plant_id;
  }
  transitionSaving.value = true; transitionError.value = '';
  try {
    await transitionSerializedInventoryItem(transitionItem.value.id, payload, { signal: controller.signal });
    transitionItem.value = null;
    await refreshAfterWrite('Unidad actualizada correctamente.');
  } catch (failure) { transitionError.value = actionError(failure); }
  finally { transitionSaving.value = false; }
}

const showQuantity = ref(false);
const quantitySaving = ref(false);
const quantityError = ref('');
function emptyMovement() {
  return { movement_type: 'in', quantity: '', source_status: '', client_id: '', plant_id: '', notes: '', use_context: false };
}
const quantityForm = ref(emptyMovement());
const quantityAvailablePlants = computed(() => plantsForClient(quantityForm.value.client_id));
watch(() => quantityForm.value.client_id, () => { quantityForm.value.plant_id = null; });
function openQuantity() { quantityForm.value = emptyMovement(); quantityError.value = ''; showQuantity.value = true; }
function closeQuantity() { if (!quantitySaving.value) showQuantity.value = false; }
const quantityNeedsSource = computed(() => ['sell', 'write_off'].includes(quantityForm.value.movement_type));
const quantityNeedsContext = computed(() => ['assign', 'install', 'return'].includes(quantityForm.value.movement_type)
  || quantityForm.value.movement_type === 'sell' && quantityForm.value.source_status === 'assigned'
  || quantityForm.value.movement_type === 'write_off' && ['assigned', 'installed'].includes(quantityForm.value.source_status));
const quantityMayUseSaleContext = computed(() => quantityForm.value.movement_type === 'sell'
  && quantityForm.value.source_status === 'available');

async function saveQuantity() {
  if (quantitySaving.value) return;
  const quantity = validDecimal(quantityForm.value.quantity, false);
  if (quantity === null) { quantityError.value = 'Ingresa una cantidad decimal mayor que cero.'; return; }
  if (quantityNeedsSource.value && !quantityForm.value.source_status) {
    quantityError.value = 'Selecciona el estado de origen.'; return;
  }
  const needsContext = quantityNeedsContext.value
    || quantityMayUseSaleContext.value && quantityForm.value.use_context;
  if (needsContext && (!quantityForm.value.client_id || !quantityForm.value.plant_id)) {
    quantityError.value = 'Selecciona cliente y planta.'; return;
  }
  const payload = {
    movement_type: quantityForm.value.movement_type,
    quantity,
    notes: quantityForm.value.notes.trim() || null,
  };
  if (quantityNeedsSource.value) payload.source_status = quantityForm.value.source_status;
  if (needsContext) {
    payload.client_id = quantityForm.value.client_id;
    payload.plant_id = quantityForm.value.plant_id;
  }
  quantitySaving.value = true; quantityError.value = '';
  try {
    await createQuantityInventoryMovement(product.value.id, payload, { signal: controller.signal });
    showQuantity.value = false;
    await refreshAfterWrite('Movimiento registrado correctamente.');
  } catch (failure) { quantityError.value = actionError(failure); }
  finally { quantitySaving.value = false; }
}

watch(() => route.params.id, load, { immediate: true });
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="inventory-detail">
    <RouterLink class="back-link" to="/inventory">‹ Volver a Inventario</RouterLink>
    <div v-if="loading" class="card page-state" role="status">Cargando producto…</div>
    <div v-else-if="notFound" class="card page-state" role="alert"><strong>Producto no encontrado</strong><p>No existe o no tienes acceso.</p></div>
    <div v-else-if="error" class="card page-state error-state" role="alert">{{ error }}</div>
    <template v-else-if="product">
      <header class="detail-header">
        <div><p class="eyebrow">{{ categoryLabel(product.category) }}</p><h1>{{ product.name }}</h1><p>{{ manufacturerModel(product) }}</p><div class="badge-row"><span class="badge control">{{ isSerialized ? 'Serializado' : 'Por cantidad' }}</span><span class="badge" :class="product.active ? 'active' : 'inactive'">{{ product.active ? 'Activo' : 'Inactivo' }}</span></div></div>
        <button v-if="canWrite" class="secondary-button" type="button" @click="openEdit">Editar producto</button>
      </header>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <p v-if="refreshError" class="refresh-error" role="alert">{{ refreshError }}</p>

      <section class="summary-grid">
        <article class="card summary-card"><span>Disponible</span><strong>{{ formatDecimal(summary.available) }}</strong><small>{{ product.unit }}</small></article>
        <article class="card summary-card"><span>Asignado</span><strong>{{ formatDecimal(summary.assigned) }}</strong><small>{{ product.unit }}</small></article>
        <article class="card summary-card"><span>Instalado</span><strong>{{ formatDecimal(summary.installed) }}</strong><small>{{ product.unit }}</small></article>
        <article class="card summary-card featured"><span>Stock físico</span><strong>{{ formatDecimal(summary.physical_stock) }}</strong><small>{{ product.unit }}</small></article>
        <article class="card summary-card secondary"><span>Vendido</span><strong>{{ formatDecimal(summary.sold) }}</strong></article>
        <article class="card summary-card secondary"><span>Baja</span><strong>{{ formatDecimal(summary.written_off) }}</strong></article>
      </section>

      <section v-if="isSerialized" class="card data-card">
        <div class="section-head"><div><p>UNIDADES</p><h2>Unidades serializadas</h2></div><button v-if="canWrite" class="primary-button" type="button" @click="openNewItem">+ Registrar unidad</button></div>
        <form class="inline-filters" @submit.prevent="loadItems"><input v-model="itemFilters.search" type="search" placeholder="Buscar número de serie" /><select v-model="itemFilters.status"><option value="">Todos los estados</option><option v-for="(label, key) in statusLabels" :key="key" :value="key">{{ label }}</option></select><select v-if="canWrite" v-model="itemFilters.clientId"><option value="">Todos los clientes</option><option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }}</option></select><select v-model="itemFilters.plantId" :disabled="canWrite && !itemFilters.clientId"><option value="">Todas las plantas</option><option v-for="plant in itemAvailablePlants" :key="plant.id" :value="plant.id">{{ plant.name }}</option></select><small v-if="canWrite && itemFilters.clientId && !itemAvailablePlants.length" class="muted">Este cliente no tiene plantas disponibles.</small><button class="secondary-button" type="submit" :disabled="itemsLoading">{{ itemsLoading ? 'Filtrando…' : 'Filtrar' }}</button></form>
        <div v-if="itemsLoading" class="empty-state" role="status">Cargando unidades…</div>
        <div v-else-if="itemsError" class="empty-state error-state" role="alert">{{ itemsError }}</div>
        <div v-else-if="!items.length" class="empty-state">No hay unidades para los filtros seleccionados.</div>
        <div v-else class="table-wrapper"><table><thead><tr><th>Número de serie</th><th>Estado</th><th>Cliente</th><th>Planta</th><th>Dispositivo</th><th>Fecha registro</th><th v-if="canWrite">Acciones</th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td class="strong">{{ item.serial_number }}</td><td><span class="badge" :class="item.status">{{ statusLabel(item.status) }}</span></td><td>{{ clientName(item.client_id) }}</td><td>{{ plantName(item.plant_id) }}</td><td>{{ deviceName(item.device_id) }}</td><td>{{ formatDate(item.created_at) }}</td><td v-if="canWrite"><div class="row-actions"><button v-for="action in allowedActions[item.status] ?? []" :key="action" class="link-button" type="button" @click="openTransition(item, action)">{{ transitionLabels[action] }}</button></div></td></tr></tbody></table></div>
      </section>

      <section class="card data-card movements-card">
        <div class="section-head"><div><p>MOVIMIENTOS</p><h2>{{ isSerialized ? 'Historial del producto' : 'Movimientos de cantidad' }}</h2></div><button v-if="canWrite && !isSerialized" class="primary-button" type="button" @click="openQuantity">+ Registrar movimiento</button></div>
        <div v-if="!movements.length" class="empty-state">No hay movimientos registrados.</div>
        <div v-else class="table-wrapper"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Cantidad</th><th>Origen</th><th>Destino</th><th>Cliente</th><th>Planta</th><th>Notas</th></tr></thead><tbody><tr v-for="movement in movements" :key="movement.id"><td>{{ formatDate(movement.created_at) }}</td><td class="strong">{{ movementLabel(movement.movement_type) }}</td><td>{{ formatDecimal(movement.quantity) }}</td><td>{{ statusLabel(movement.from_status) }}</td><td>{{ statusLabel(movement.to_status) }}</td><td>{{ clientName(movement.client_id) }}</td><td>{{ plantName(movement.plant_id) }}</td><td>{{ movement.notes || '—' }}</td></tr></tbody></table></div>
      </section>
    </template>

    <div v-if="showEdit" class="modal-backdrop" @click.self="closeEdit"><section class="card modal" role="dialog" aria-modal="true" aria-label="Editar producto"><h2>Editar producto</h2><form @submit.prevent="saveEdit"><label>Nombre *<input v-model="editForm.name" required :disabled="editSaving" /></label><div class="form-grid"><label>Categoría<select v-model="editForm.category" :disabled="editSaving"><option v-for="(label, key) in categories" :key="key" :value="key">{{ label }}</option></select></label><label>Unidad *<input v-model="editForm.unit" required :disabled="editSaving" /></label><label>Fabricante<input v-model="editForm.manufacturer" :disabled="editSaving" /></label><label>Modelo<input v-model="editForm.model" :disabled="editSaving" /></label><label>Tipo de control<select v-model="editForm.tracking_mode" :disabled="editSaving"><option value="serialized">Serializado</option><option value="quantity">Por cantidad</option></select></label><label>Nivel mínimo<input v-model="editForm.reorder_level" inputmode="decimal" :disabled="editSaving" /></label></div><label class="check-row"><input v-model="editForm.active" type="checkbox" :disabled="editSaving" /> Producto activo</label><p class="muted">El tipo de control no puede cambiar después del primer uso.</p><p v-if="editError" class="form-error" role="alert">{{ editError }}</p><div class="modal-actions"><button class="secondary-button" type="button" :disabled="editSaving" @click="closeEdit">Cancelar</button><button class="primary-button" type="submit" :disabled="editSaving">{{ editSaving ? 'Guardando…' : 'Guardar' }}</button></div></form></section></div>

    <div v-if="showNewItem" class="modal-backdrop" @click.self="closeNewItem"><section class="card modal narrow" role="dialog" aria-modal="true" aria-label="Registrar unidad"><h2>Registrar unidad</h2><form @submit.prevent="saveNewItem"><label>Número de serie *<input v-model="itemForm.serial_number" required :disabled="itemSaving" /></label><small class="muted">El backend elimina espacios externos y convierte el serial a mayúsculas.</small><label>Notas<textarea v-model="itemForm.notes" rows="3" :disabled="itemSaving"></textarea></label><p v-if="itemError" class="form-error" role="alert">{{ itemError }}</p><div class="modal-actions"><button class="secondary-button" type="button" :disabled="itemSaving" @click="closeNewItem">Cancelar</button><button class="primary-button" type="submit" :disabled="itemSaving">{{ itemSaving ? 'Registrando…' : 'Registrar unidad' }}</button></div></form></section></div>

    <div v-if="transitionItem" class="modal-backdrop" @click.self="closeTransition"><section class="card modal narrow" role="dialog" aria-modal="true" :aria-label="transitionLabels[transitionType]"><h2>{{ transitionLabels[transitionType] }}</h2><p class="muted">Serie: {{ transitionItem.serial_number }}</p><form @submit.prevent="applyTransition"><template v-if="transitionType === 'assign'"><label>Cliente *<select v-model="transitionForm.client_id" required :disabled="transitionSaving"><option value="" disabled>Selecciona un cliente</option><option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }}</option></select></label><label>Planta *<select v-model="transitionForm.plant_id" required :disabled="transitionSaving || !transitionForm.client_id || !transitionAvailablePlants.length"><option value="" disabled>Selecciona una planta</option><option v-for="plant in transitionAvailablePlants" :key="plant.id" :value="plant.id">{{ plant.name }}</option></select></label><small v-if="transitionForm.client_id && !transitionAvailablePlants.length" class="muted">Este cliente no tiene plantas disponibles.</small></template><template v-if="transitionType === 'install'"><label>Planta<input :value="plantName(transitionItem.plant_id)" disabled /></label><label>Dispositivo opcional<select v-model="transitionForm.device_id" :disabled="transitionSaving"><option value="">Sin dispositivo</option><option v-for="device in installDevices" :key="device.id" :value="device.id">{{ device.name || device.serial_number }}</option></select></label></template><template v-if="transitionType === 'sell' && transitionItem.status === 'available'"><label class="check-row"><input v-model="transitionForm.use_context" type="checkbox" :disabled="transitionSaving" /> Agregar contexto comercial</label><template v-if="transitionForm.use_context"><label>Cliente *<select v-model="transitionForm.client_id" :disabled="transitionSaving"><option value="">Selecciona un cliente</option><option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }}</option></select></label><label>Planta *<select v-model="transitionForm.plant_id" :disabled="transitionSaving || !transitionForm.client_id || !transitionAvailablePlants.length"><option value="">Selecciona una planta</option><option v-for="plant in transitionAvailablePlants" :key="plant.id" :value="plant.id">{{ plant.name }}</option></select></label><small v-if="transitionForm.client_id && !transitionAvailablePlants.length" class="muted">Este cliente no tiene plantas disponibles.</small></template></template><p v-if="transitionDescription()" class="confirm-copy">{{ transitionDescription() }}</p><label>Notas<textarea v-model="transitionForm.notes" rows="3" :disabled="transitionSaving"></textarea></label><p v-if="transitionError" class="form-error" role="alert">{{ transitionError }}</p><div class="modal-actions"><button class="secondary-button" type="button" :disabled="transitionSaving" @click="closeTransition">Cancelar</button><button class="primary-button" type="submit" :disabled="transitionSaving">{{ transitionSaving ? 'Guardando…' : 'Confirmar' }}</button></div></form></section></div>

    <div v-if="showQuantity" class="modal-backdrop" @click.self="closeQuantity"><section class="card modal" role="dialog" aria-modal="true" aria-label="Registrar movimiento"><h2>Registrar movimiento</h2><form @submit.prevent="saveQuantity"><label>Tipo *<select v-model="quantityForm.movement_type" :disabled="quantitySaving"><option v-for="(label, key) in movementLabels" :key="key" :value="key">{{ label }}</option></select></label><label>Cantidad *<input v-model="quantityForm.quantity" inputmode="decimal" placeholder="0.00" required :disabled="quantitySaving" /></label><label v-if="quantityNeedsSource">Origen *<select v-model="quantityForm.source_status" :disabled="quantitySaving"><option value="" disabled>Selecciona origen</option><option value="available">Disponible</option><option value="assigned">Asignado</option><option v-if="quantityForm.movement_type === 'write_off'" value="installed">Instalado</option></select></label><label v-if="quantityMayUseSaleContext" class="check-row"><input v-model="quantityForm.use_context" type="checkbox" :disabled="quantitySaving" /> Agregar contexto comercial</label><template v-if="quantityNeedsContext || quantityMayUseSaleContext && quantityForm.use_context"><label>Cliente *<select v-model="quantityForm.client_id" :disabled="quantitySaving"><option value="" disabled>Selecciona un cliente</option><option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }}</option></select></label><label>Planta *<select v-model="quantityForm.plant_id" :disabled="quantitySaving || !quantityForm.client_id || !quantityAvailablePlants.length"><option value="" disabled>Selecciona una planta</option><option v-for="plant in quantityAvailablePlants" :key="plant.id" :value="plant.id">{{ plant.name }}</option></select></label><small v-if="quantityForm.client_id && !quantityAvailablePlants.length" class="muted">Este cliente no tiene plantas disponibles.</small></template><label>Notas<textarea v-model="quantityForm.notes" rows="3" :disabled="quantitySaving"></textarea></label><p class="muted">El backend valida el saldo disponible al confirmar.</p><p v-if="quantityError" class="form-error" role="alert">{{ quantityError }}</p><div class="modal-actions"><button class="secondary-button" type="button" :disabled="quantitySaving" @click="closeQuantity">Cancelar</button><button class="primary-button" type="submit" :disabled="quantitySaving">{{ quantitySaving ? 'Registrando…' : 'Registrar movimiento' }}</button></div></form></section></div>
  </div>
</template>

<style scoped>
.inventory-detail { width: 100%; min-width: 0; }
.back-link { display: inline-block; margin-bottom: 14px; color: var(--rdx-primary); font-size: 13px; font-weight: 650; }
.detail-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin-bottom: 18px; }
.detail-header h1 { margin: 3px 0; }
.detail-header p { margin: 0; color: var(--rdx-text-muted); }
.eyebrow, .section-head p { font-size: 11px; font-weight: 750; letter-spacing: .08em; }
.badge-row { display: flex; gap: 7px; margin-top: 9px; }
.badge { display: inline-flex; padding: 5px 9px; border-radius: 999px; background: var(--rdx-neutral-soft); color: var(--rdx-text-muted); font-size: 10px; font-weight: 750; white-space: nowrap; }
.badge.control, .badge.assigned, .badge.installed { background: var(--rdx-primary-soft); color: var(--rdx-primary); }
.badge.active, .badge.available { background: var(--rdx-success-soft); color: var(--rdx-success); }
.badge.inactive, .badge.written_off { background: var(--rdx-warning-soft); color: var(--rdx-warning); }
.primary-button, .secondary-button { min-height: 39px; padding: 8px 14px; border-radius: var(--rdx-radius-sm); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.primary-button { border: 1px solid var(--rdx-primary); background: var(--rdx-primary); color: #fff; }
.secondary-button { border: 1px solid var(--rdx-border); background: var(--rdx-surface); color: var(--rdx-text-strong); }
button:disabled { opacity: .6; cursor: wait; }
.notice { padding: 10px 14px; border-radius: var(--rdx-radius-sm); background: var(--rdx-success-soft); color: var(--rdx-success); font-size: 12px; }
.refresh-error { padding: 10px 14px; border-radius: var(--rdx-radius-sm); background: var(--rdx-warning-soft); color: var(--rdx-text-strong); font-size: 12px; }
.summary-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 11px; margin-bottom: 17px; }
.summary-card { display: grid; min-width: 0; padding: 15px; }
.summary-card span { color: var(--rdx-text-muted); font-size: 11px; font-weight: 700; }
.summary-card strong { margin: 5px 0; color: var(--rdx-text-strong); font-size: 24px; overflow-wrap: anywhere; }
.summary-card small { color: var(--rdx-text-faint); font-size: 10px; }
.summary-card.featured { background: var(--rdx-primary-soft); }
.summary-card.secondary { opacity: .85; }
.data-card { margin-bottom: 17px; padding: 0; overflow: hidden; }
.section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 17px 19px; border-bottom: 1px solid var(--rdx-border); }
.section-head p { margin: 0; color: var(--rdx-text-muted); }
.section-head h2 { margin: 3px 0 0; font-size: 17px; }
.inline-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 9px; padding: 12px 18px; border-bottom: 1px solid var(--rdx-border); }
.inline-filters input, .inline-filters select, .modal input, .modal select, .modal textarea { width: 100%; min-height: 39px; padding: 8px 10px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: var(--rdx-surface); color: var(--rdx-text-strong); font: inherit; }
.table-wrapper { width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { padding: 10px 12px; background: var(--rdx-neutral-soft); color: var(--rdx-text-muted); font-size: 10px; letter-spacing: .04em; text-align: left; white-space: nowrap; }
td { padding: 13px 12px; border-top: 1px solid var(--rdx-border); color: var(--rdx-text-muted); vertical-align: middle; }
.strong { color: var(--rdx-text-strong); font-weight: 650; }
.row-actions { display: flex; flex-wrap: wrap; gap: 2px; min-width: 160px; }
.link-button { padding: 4px 6px; border: 0; background: transparent; color: var(--rdx-primary); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.empty-state, .page-state { padding: 32px 20px; color: var(--rdx-text-muted); text-align: center; }
.error-state, .form-error { color: var(--rdx-danger); }
.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / .45); }
.modal { width: min(600px, 100%); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 22px; }
.modal.narrow { width: min(470px, 100%); }
.modal h2 { margin: 0 0 13px; font-size: 19px; }
.modal form { display: grid; gap: 11px; }
.modal label { display: grid; gap: 5px; color: var(--rdx-text-muted); font-size: 12px; font-weight: 650; }
.modal textarea { resize: vertical; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.check-row { display: flex !important; grid-template-columns: auto 1fr; align-items: center; flex-direction: row; gap: 8px !important; }
.check-row input { width: auto; min-height: auto; }
.muted { margin: 0; color: var(--rdx-text-muted); font-size: 11px; }
.confirm-copy { padding: 10px 12px; border-radius: var(--rdx-radius-sm); background: var(--rdx-warning-soft); color: var(--rdx-text-strong); font-size: 12px; }
.form-error { margin: 0; font-size: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
@media (max-width: 1150px) { .summary-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 760px) { .detail-header { flex-direction: column; } .summary-grid { grid-template-columns: repeat(2, 1fr); } .inline-filters, .form-grid { grid-template-columns: 1fr; } }
@media (max-width: 430px) { .summary-grid { grid-template-columns: 1fr; } .modal-actions { flex-direction: column-reverse; } .modal-actions button { width: 100%; } }
</style>
