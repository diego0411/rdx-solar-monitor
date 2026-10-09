<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getMyProfile } from '../services/api.js';
import { useModalEscape } from '../composables/useModalStack.js';
import { createInventoryProduct, listInventoryProducts } from '../services/inventory.js';
import {
  cancelOperation,
  confirmOperation,
  createOperation,
  getOperation,
  listOperations,
} from '../services/inventory.js';
import { inventoryCategoryLabel as categoryLabel, inventoryCategoryLabels as categories } from '../utils/inventoryCategories.js';
import { exportInventoryToExcel, downloadExcel } from '../utils/excelExport.js';
const trackingLabels = { serialized: 'Serializado', quantity: 'Por cantidad' };

const products = ref([]);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const role = ref(null);
const controller = new AbortController();

const filters = ref({ search: '', category: '', trackingMode: '', active: '' });
const canWrite = computed(() => role.value === 'rdx_admin');
const permissions = ref([]);
const canWriteOperations = computed(() => role.value === 'rdx_admin'
  || (role.value === 'client_admin'
    && (!Array.isArray(permissions.value) || permissions.value.includes('inventory'))));

const activeTab = ref('products');
const operationTypeLabels = { IN: 'Entrada', ADJUST_IN: 'Ajuste +', ADJUST_OUT: 'Ajuste −' };
const operationStatusLabels = { draft: 'Borrador', confirmed: 'Confirmado', cancelled: 'Cancelado' };

function operationTypeLabel(value) { return operationTypeLabels[value] ?? value ?? '—'; }
function operationStatusLabel(value) { return operationStatusLabels[value] ?? value ?? '—'; }

const PAGE_SIZE = 10;
const currentPage = ref(1);

function matchesFilters(product) {
  const criteria = filters.value;
  if (criteria.category && product.category !== criteria.category) return false;
  if (criteria.trackingMode && product.tracking_mode !== criteria.trackingMode) return false;
  if (criteria.active === 'true' && product.active !== true) return false;
  if (criteria.active === 'false' && product.active !== false) return false;
  const term = String(criteria.search ?? '').trim().toLowerCase();
  if (term) {
    const haystack = [product.name, product.manufacturer, product.model];
    if (!haystack.some(value => typeof value === 'string' && value.toLowerCase().includes(term))) return false;
  }
  return true;
}

// Catálogo completo → filtros actuales → resultados → paginación.
const filteredProducts = computed(() => products.value.filter(matchesFilters));
const resultCount = computed(() => filteredProducts.value.length);
const pageCount = computed(() => Math.max(1, Math.ceil(resultCount.value / PAGE_SIZE)));
const pagedProducts = computed(() => filteredProducts.value.slice(
  (currentPage.value - 1) * PAGE_SIZE,
  currentPage.value * PAGE_SIZE,
));
const pageRange = computed(() => {
  if (resultCount.value === 0) return '0 de 0';
  const start = (currentPage.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage.value * PAGE_SIZE, resultCount.value);
  return `${start}–${end} de ${resultCount.value}`;
});
const pageLabel = computed(() => `Página ${currentPage.value} de ${pageCount.value}`);

function prevPage() {
  if (currentPage.value > 1) currentPage.value -= 1;
}

function nextPage() {
  if (currentPage.value < pageCount.value) currentPage.value += 1;
}

watch(filters, () => { currentPage.value = 1; }, { deep: true });
watch(pageCount, count => { if (currentPage.value > count) currentPage.value = count; });

function decimalIsPositive(value) {
  const text = String(value ?? '').trim();
  if (!/^\+?\d+(?:\.\d+)?$/.test(text)) return false;
  return /[1-9]/.test(text);
}

const kpis = computed(() => ({
  products: products.value.length,
  available: products.value.filter(product => decimalIsPositive(product.summary?.available)).length,
  dispatched: products.value.filter(product => decimalIsPositive(product.summary?.dispatched)).length,
  assigned: products.value.filter(product => decimalIsPositive(product.summary?.assigned)).length,
  installed: products.value.filter(product => decimalIsPositive(product.summary?.installed)).length,
  physical: products.value.filter(product => decimalIsPositive(product.summary?.physical_stock)).length,
}));

function formatDecimal(value) {
  const text = String(value ?? '').trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return '—';
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${match[1] === '-' ? '-' : ''}${grouped}${match[3] ? `,${match[3]}` : ''}`;
}

function trackingLabel(value) { return trackingLabels[value] ?? value ?? '—'; }

function manufacturerModel(product) {
  return [product.manufacturer, product.model].filter(Boolean).join(' · ') || '—';
}

async function loadProducts() {
  loading.value = true;
  error.value = '';
  try {
    const params = Object.fromEntries(Object.entries(filters.value).filter(([, value]) => value !== ''));
    const data = await listInventoryProducts(params, { signal: controller.signal });
    if (!Array.isArray(data)) throw new Error('Respuesta inválida');
    products.value = data;
    currentPage.value = 1;
  } catch {
    if (!controller.signal.aborted) {
      error.value = 'No se pudo cargar el inventario. Comprueba la conexión y vuelve a intentarlo.';
    }
  } finally {
    loading.value = false;
  }
}

function clearFilters() {
  filters.value = { search: '', category: '', trackingMode: '', active: '' };
  currentPage.value = 1;
  void loadProducts();
}

async function exportInventory() {
  if (exporting.value || !filteredProducts.value.length) return;
  exporting.value = true;
  try {
    const filtersToExport = { ...filters.value };
    const { buffer, fileName } = await exportInventoryToExcel(filteredProducts.value, filtersToExport);
    downloadExcel(buffer, fileName);
  } catch (err) {
    console.error('Error exportando inventario:', err);
    notice.value = 'No se pudo generar el archivo Excel.';
  } finally {
    exporting.value = false;
  }
}

const showCreate = ref(false);
const saving = ref(false);
const formError = ref('');
const exporting = ref(false);

function emptyProduct() {
  return {
    name: '', category: 'inverter', manufacturer: '', model: '', unit: 'unidad',
    tracking_mode: 'serialized', reorder_level: '0',
  };
}
const form = ref(emptyProduct());

function openCreate() {
  form.value = emptyProduct();
  formError.value = '';
  showCreate.value = true;
}

function closeCreate() {
  if (saving.value) return;
  showCreate.value = false;
}

function validNonNegativeDecimal(value) {
  const text = String(value ?? '').trim();
  return /^\d+(?:\.\d+)?$/.test(text) ? text : null;
}

function productPayload() {
  const name = form.value.name.trim();
  const unit = form.value.unit.trim();
  const reorderLevel = validNonNegativeDecimal(form.value.reorder_level);
  if (!name) return { error: 'El nombre es obligatorio.' };
  if (!(form.value.category in categories)) return { error: 'Selecciona una categoría válida.' };
  if (!unit) return { error: 'La unidad es obligatoria.' };
  if (!(form.value.tracking_mode in trackingLabels)) return { error: 'Selecciona un tipo de control válido.' };
  if (reorderLevel === null) return { error: 'El nivel mínimo debe ser un decimal mayor o igual a cero.' };
  return { payload: {
    name,
    category: form.value.category,
    manufacturer: form.value.manufacturer.trim() || null,
    model: form.value.model.trim() || null,
    unit,
    tracking_mode: form.value.tracking_mode,
    reorder_level: reorderLevel,
  } };
}

async function saveProduct() {
  if (saving.value) return;
  formError.value = '';
  const { payload, error: validationError } = productPayload();
  if (validationError) { formError.value = validationError; return; }
  saving.value = true;
  try {
    await createInventoryProduct(payload, { signal: controller.signal });
    showCreate.value = false;
    notice.value = 'Producto creado correctamente.';
    await loadProducts();
  } catch (failure) {
    if (!controller.signal.aborted) {
      formError.value = failure?.status === 403
        ? 'No tienes permiso para crear productos.'
        : failure?.detail || 'No se pudo crear el producto.';
    }
  } finally {
    saving.value = false;
  }
}

// ---- Movimientos multiítem (RPC 033). Sin lógica de stock en frontend. ----
const operations = ref([]);
const opLoading = ref(false);
const opError = ref('');
const opNotice = ref('');
const opFilters = ref({ operationType: '', status: '', dateFrom: '', dateTo: '' });
const operationsLoaded = ref(false);

async function loadOperations() {
  opLoading.value = true;
  opError.value = '';
  try {
    const params = Object.fromEntries(Object.entries({
      operationType: opFilters.value.operationType,
      status: opFilters.value.status,
      dateFrom: opFilters.value.dateFrom,
      dateTo: opFilters.value.dateTo,
    }).filter(([, value]) => value !== ''));
    const data = await listOperations(params, { signal: controller.signal });
    if (!Array.isArray(data)) throw new Error('Respuesta inválida');
    operations.value = data;
    operationsLoaded.value = true;
  } catch {
    if (!controller.signal.aborted) {
      opError.value = 'No se pudieron cargar los movimientos. Comprueba la conexión y vuelve a intentarlo.';
    }
  } finally {
    opLoading.value = false;
  }
}

function switchTab(name) {
  activeTab.value = name;
  if (name === 'movements' && !operationsLoaded.value) void loadOperations();
}

function clearOpFilters() {
  opFilters.value = { operationType: '', status: '', dateFrom: '', dateTo: '' };
  void loadOperations();
}

const showOpCreate = ref(false);
const opSaving = ref(false);
const opFormError = ref('');
const draftKey = ref('');

function emptyOpLine() {
  return { product_id: '', quantity: '', serial_text: '', notes: '' };
}

function emptyOpForm() {
  return { operation_type: 'IN', operation_date: '', reference: '', notes: '', lines: [emptyOpLine()] };
}

const opForm = ref(emptyOpForm());

function openOpCreate() {
  opForm.value = emptyOpForm();
  opFormError.value = '';
  draftKey.value = crypto.randomUUID();
  showOpCreate.value = true;
}

function closeOpCreate() {
  if (opSaving.value) return;
  showOpCreate.value = false;
}

function productById(id) {
  return products.value.find(product => product.id === id) ?? null;
}

function lineProduct(line) {
  return line.product_id ? productById(line.product_id) : null;
}

function lineIsSerialized(line) {
  return lineProduct(line)?.tracking_mode === 'serialized';
}

function eligibleProducts(line) {
  const used = new Set(opForm.value.lines
    .filter(other => other !== line && other.product_id)
    .map(other => other.product_id));
  return products.value.filter(product => product.active !== false
    && !used.has(product.id)
    && (opForm.value.operation_type === 'IN' || product.tracking_mode !== 'serialized'));
}

function onOpTypeChange() {
  for (const line of opForm.value.lines) {
    const product = lineProduct(line);
    if (product && opForm.value.operation_type !== 'IN' && product.tracking_mode === 'serialized') {
      line.product_id = '';
      line.serial_text = '';
    }
  }
}

function lineSerials(line) {
  return String(line.serial_text ?? '').split('\n').map(item => item.trim()).filter(Boolean);
}

function serialCountText(line) {
  const wanted = String(line.quantity ?? '').trim() || '?';
  return `${lineSerials(line).length} de ${wanted} seriales`;
}

function addOpLine() {
  opForm.value.lines.push(emptyOpLine());
}

function removeOpLine(index) {
  if (opForm.value.lines.length <= 1) return;
  opForm.value.lines.splice(index, 1);
}

function validPositiveInteger(value) {
  const text = String(value ?? '').trim();
  return /^[1-9]\d*$/.test(text) ? text : null;
}

function opPayload() {
  if (!(opForm.value.operation_type in operationTypeLabels)) {
    return { error: 'Selecciona un tipo de movimiento válido.' };
  }
  if (!Array.isArray(opForm.value.lines) || opForm.value.lines.length === 0) {
    return { error: 'Agrega al menos un producto.' };
  }
  const seen = new Set();
  const lines = [];
  for (let index = 0; index < opForm.value.lines.length; index += 1) {
    const line = opForm.value.lines[index];
    const product = lineProduct(line);
    if (!product) return { error: `La línea ${index + 1} necesita un producto.` };
    if (seen.has(product.id)) return { error: 'Una operación no puede repetir el mismo producto.' };
    seen.add(product.id);
    const clean = { product_id: product.id };
    if (product.tracking_mode === 'serialized') {
      if (opForm.value.operation_type !== 'IN') {
        return { error: 'Los serializados solo admiten Entrada.' };
      }
      const wanted = validPositiveInteger(line.quantity);
      if (wanted === null) return { error: `La línea ${index + 1} necesita una cantidad entera.` };
      const serials = lineSerials(line);
      if (serials.length !== Number(wanted)) {
        return { error: `La línea ${index + 1} requiere ${wanted} seriales (hay ${serials.length}).` };
      }
      clean.quantity = Number(wanted);
      clean.serial_numbers = serials;
    } else {
      if (!decimalIsPositive(line.quantity)) return { error: `La línea ${index + 1} necesita una cantidad válida.` };
      clean.quantity = String(line.quantity).trim();
    }
    const notes = String(line.notes ?? '').trim();
    if (notes) clean.notes = notes;
    lines.push(clean);
  }
  const payload = { operation_type: opForm.value.operation_type, lines };
  const date = String(opForm.value.operation_date ?? '').trim();
  if (date) payload.operation_date = date;
  const reference = String(opForm.value.reference ?? '').trim();
  if (reference) payload.reference = reference;
  const notes = String(opForm.value.notes ?? '').trim();
  if (notes) payload.notes = notes;
  return { payload };
}

async function saveDraft() {
  if (opSaving.value) return;
  opFormError.value = '';
  const { payload, error: validationError } = opPayload();
  if (validationError) { opFormError.value = validationError; return; }
  opSaving.value = true;
  try {
    const created = await createOperation(payload, draftKey.value, { signal: controller.signal });
    showOpCreate.value = false;
    opNotice.value = 'Borrador guardado correctamente.';
    await loadOperations();
    if (created?.id) await openOpDetail(created.id);
  } catch (failure) {
    if (!controller.signal.aborted) {
      opFormError.value = failure?.status === 403
        ? 'No tienes permiso para crear operaciones.'
        : failure?.detail || 'No se pudo guardar el borrador.';
    }
  } finally {
    opSaving.value = false;
  }
}

const selectedOp = ref(null);
const showOpDetail = ref(false);
const opDetailLoading = ref(false);
const opDetailError = ref('');
const pendingAction = ref(null);
const actionKey = ref('');
const acting = ref(false);
const actionError = ref('');

async function openOpDetail(id) {
  showOpDetail.value = true;
  opDetailLoading.value = true;
  opDetailError.value = '';
  pendingAction.value = null;
  try {
    selectedOp.value = await getOperation(id, { signal: controller.signal });
  } catch {
    if (!controller.signal.aborted) {
      opDetailError.value = 'No se pudo cargar el detalle de la operación.';
    }
  } finally {
    opDetailLoading.value = false;
  }
}

function closeOpDetail() {
  if (acting.value) return;
  showOpDetail.value = false;
  selectedOp.value = null;
}

// UX-03C2A: Escape cierra el modal superior; scroll del fondo bloqueado.
useModalEscape(() => showCreate.value, closeCreate);
useModalEscape(() => showOpCreate.value, closeOpCreate);
useModalEscape(() => showOpDetail.value, closeOpDetail);

function askOpAction(kind) {
  pendingAction.value = kind;
  actionError.value = '';
  actionKey.value = crypto.randomUUID();
}

function cancelOpAction() {
  if (acting.value) return;
  pendingAction.value = null;
}

async function runOpAction() {
  if (acting.value || !pendingAction.value || !selectedOp.value?.operation?.id) return;
  acting.value = true;
  actionError.value = '';
  try {
    const id = selectedOp.value.operation.id;
    const updated = pendingAction.value === 'confirm'
      ? await confirmOperation(id, actionKey.value, { signal: controller.signal })
      : await cancelOperation(id, actionKey.value, { signal: controller.signal });
    pendingAction.value = null;
    opNotice.value = updated?.status === 'confirmed'
      ? 'Operación confirmada. El inventario fue actualizado.'
      : 'Borrador cancelado correctamente.';
    await loadOperations();
    await openOpDetail(id);
    await loadProducts();
  } catch (failure) {
    if (!controller.signal.aborted) {
      actionError.value = failure?.status === 403
        ? 'No tienes permiso para esta acción.'
        : failure?.detail || 'No se pudo completar la acción.';
    }
  } finally {
    acting.value = false;
  }
}

onMounted(async () => {
  try {
    const me = await getMyProfile();
    role.value = me?.profile?.role ?? null;
    permissions.value = Array.isArray(me?.profile?.module_permissions)
      ? me.profile.module_permissions
      : [];
  } catch {
    role.value = null;
  }
  await loadProducts();
});
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="inventory-page">
    <header class="page-header inventory-header">
      <div>
        <p class="eyebrow">OPERACIONES</p>
        <h1>Inventario</h1>
        <p>Control de equipos, materiales y asignaciones.</p>
      </div>
      <div class="header-actions">
        <button class="secondary-button" type="button" :disabled="exporting || !filteredProducts.length" @click="exportInventory">
          <span v-if="exporting">Generando…</span>
          <span v-else>Exportar Excel</span>
        </button>
        <button v-if="canWrite" class="primary-button" type="button" @click="openCreate">+ Nuevo producto</button>
      </div>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="opNotice" class="notice" role="status">{{ opNotice }}</p>

    <nav class="tabs" aria-label="Secciones de inventario">
      <button type="button" :class="{ active: activeTab === 'products' }" @click="switchTab('products')">Productos</button>
      <button type="button" :class="{ active: activeTab === 'movements' }" @click="switchTab('movements')">Movimientos</button>
    </nav>

    <div v-if="activeTab === 'products'" class="inventory-sticky">
      <section class="kpi-grid" aria-label="Resumen de inventario">
        <article class="card kpi"><span>Productos</span><strong>{{ kpis.products }}</strong><small>productos visibles</small></article>
        <article class="card kpi"><span>Disponible</span><strong>{{ kpis.available }}</strong><small>productos con saldo</small></article>
        <article class="card kpi"><span>Despachado</span><strong>{{ kpis.dispatched }}</strong><small>salida operativa de almacén</small></article>
        <article class="card kpi"><span>Asignado</span><strong>{{ kpis.assigned }}</strong><small>productos con saldo</small></article>
        <article class="card kpi"><span>Instalado</span><strong>{{ kpis.installed }}</strong><small>productos con saldo</small></article>
        <article class="card kpi featured"><span>Stock físico</span><strong>{{ kpis.physical }}</strong><small>productos con existencia</small></article>
      </section>
      <p class="kpi-note">Los saldos no se suman entre productos con unidades diferentes.</p>

      <form class="card filters" aria-label="Filtros de inventario" @submit.prevent="loadProducts">
        <label><span>Buscar</span><input v-model="filters.search" type="search" placeholder="Nombre, fabricante o modelo" /></label>
        <label><span>Categoría</span><select v-model="filters.category"><option value="">Todos</option><option v-for="(label, key) in categories" :key="key" :value="key">{{ label }}</option></select></label>
        <label><span>Tipo de control</span><select v-model="filters.trackingMode"><option value="">Todos</option><option value="serialized">Serializado</option><option value="quantity">Por cantidad</option></select></label>
        <label><span>Estado</span><select v-model="filters.active"><option value="">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></select></label>
        <div class="filter-actions"><button class="primary-button compact" type="submit" :disabled="loading">Aplicar</button><button class="text-button" type="button" :disabled="loading" @click="clearFilters">Limpiar</button></div>
      </form>
    </div>

    <section v-if="activeTab === 'products'" class="card product-section">
      <div class="section-head"><div><p>CATÁLOGO</p><h2>Productos</h2></div><span>{{ products.length }}</span></div>
      <div v-if="loading" class="page-state" role="status">Consultando inventario…</div>
      <div v-else-if="error" class="page-state error-state" role="alert">{{ error }}</div>
      <div v-else-if="!filteredProducts.length" class="page-state">No hay productos para los filtros seleccionados.</div>
      <div v-else class="table-wrapper">
        <table>
<thead><tr><th>Producto</th><th>Categoría</th><th>Fabricante</th><th>Disponible</th><th>Stock físico</th><th>Acción</th></tr></thead>
            <tbody>
              <tr v-for="product in pagedProducts" :key="product.id">
                <td class="product-name"><strong>{{ product.name }}</strong><small>{{ product.unit }}</small></td>
                <td>{{ categoryLabel(product.category) }}</td>
                <td>{{ product.manufacturer ?? '—' }}</td>
                <td>{{ formatDecimal(product.summary?.available) }}</td>
                <td class="stock-cell">{{ formatDecimal(product.summary?.physical_stock) }}</td>
                <td><RouterLink class="detail-link" :to="`/inventory/${product.id}`">Ver detalle</RouterLink></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!loading && !error" class="pagination">
        <span class="page-range">{{ pageRange }}</span>
        <div class="page-controls">
          <button class="secondary-button compact" type="button" :disabled="currentPage <= 1" @click="prevPage">Anterior</button>
          <span class="page-label">{{ pageLabel }}</span>
          <button class="secondary-button compact" type="button" :disabled="currentPage >= pageCount" @click="nextPage">Siguiente</button>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'movements'" class="card product-section">
      <div class="section-head">
        <div><p>MOVIMIENTOS</p><h2>Operaciones de almacén</h2></div>
        <div class="header-actions">
          <span>{{ operations.length }}</span>
          <button v-if="canWriteOperations" class="primary-button compact" type="button" @click="openOpCreate">+ Nueva operación</button>
        </div>
      </div>
      <form class="card filters" aria-label="Filtros de movimientos" @submit.prevent="loadOperations">
        <label><span>Tipo</span><select v-model="opFilters.operationType"><option value="">Todos</option><option v-for="(label, key) in operationTypeLabels" :key="key" :value="key">{{ label }}</option></select></label>
        <label><span>Estado</span><select v-model="opFilters.status"><option value="">Todos</option><option v-for="(label, key) in operationStatusLabels" :key="key" :value="key">{{ label }}</option></select></label>
        <label><span>Desde</span><input v-model="opFilters.dateFrom" type="date" /></label>
        <label><span>Hasta</span><input v-model="opFilters.dateTo" type="date" /></label>
        <div class="filter-actions"><button class="primary-button compact" type="submit" :disabled="opLoading">Aplicar</button><button class="text-button" type="button" :disabled="opLoading" @click="clearOpFilters">Limpiar</button></div>
      </form>
      <div v-if="opLoading" class="page-state" role="status">Consultando movimientos…</div>
      <div v-else-if="opError" class="page-state error-state" role="alert">{{ opError }}</div>
      <div v-else-if="!operations.length" class="page-state">No hay operaciones para los filtros seleccionados.</div>
      <div v-else class="table-wrapper">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Referencia</th><th>Estado</th><th>Líneas</th><th>Creado</th><th>Acción</th></tr></thead>
          <tbody>
            <tr v-for="op in operations" :key="op.id">
              <td>{{ op.operation_date ?? '—' }}</td>
              <td><span class="badge control">{{ operationTypeLabel(op.operation_type) }}</span></td>
              <td>{{ op.reference ?? '—' }}</td>
              <td><span class="badge" :class="{ active: op.status === 'confirmed', inactive: op.status === 'cancelled' }">{{ operationStatusLabel(op.status) }}</span></td>
              <td>{{ op.line_count ?? op.lines?.length ?? '—' }}</td>
              <td>{{ op.created_at ? String(op.created_at).slice(0, 10) : '—' }}</td>
              <td><button class="detail-link text-button" type="button" @click="openOpDetail(op.id)">Ver detalle</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="showOpCreate" class="modal-backdrop" @click.self="closeOpCreate">
      <section class="card modal modal-wide" role="dialog" aria-modal="true" aria-label="Nueva operación">
        <div class="modal-title"><div><p>NUEVO MOVIMIENTO</p><h2>Nueva operación</h2></div><button type="button" :disabled="opSaving" aria-label="Cerrar" @click="closeOpCreate">×</button></div>
        <form @submit.prevent="saveDraft">
          <div class="form-grid">
            <label>Tipo *<select v-model="opForm.operation_type" :disabled="opSaving" @change="onOpTypeChange"><option value="IN">Entrada</option><option value="ADJUST_IN">Ajuste positivo</option><option value="ADJUST_OUT">Ajuste negativo</option></select></label>
            <label>Fecha<input v-model="opForm.operation_date" type="date" :disabled="opSaving" /></label>
          </div>
          <div class="form-grid">
            <label>Referencia<input v-model="opForm.reference" maxlength="200" :disabled="opSaving" /></label>
            <label>Notas<input v-model="opForm.notes" maxlength="4000" :disabled="opSaving" /></label>
          </div>
          <fieldset>
            <legend>Productos *</legend>
            <div v-for="(line, index) in opForm.lines" :key="index" class="op-line">
              <div class="form-grid">
                <label>Producto *<select v-model="line.product_id" :disabled="opSaving"><option value="">Seleccionar…</option><option v-for="product in eligibleProducts(line)" :key="product.id" :value="product.id">{{ product.name }} · {{ trackingLabel(product.tracking_mode) }}</option></select></label>
                <label>Cantidad *<input v-model="line.quantity" inputmode="decimal" :disabled="opSaving" /></label>
              </div>
              <label v-if="lineIsSerialized(line)">Números de serie *<small>{{ serialCountText(line) }}</small><textarea v-model="line.serial_text" rows="3" placeholder="Un serial por línea" :disabled="opSaving" /></label>
              <label>Notas de línea<input v-model="line.notes" maxlength="4000" :disabled="opSaving" /></label>
              <div class="line-actions"><button class="text-button danger" type="button" :disabled="opSaving || opForm.lines.length <= 1" @click="removeOpLine(index)">Eliminar</button></div>
            </div>
            <button class="secondary-button compact" type="button" :disabled="opSaving" @click="addOpLine">+ Agregar producto</button>
          </fieldset>
          <p v-if="opFormError" class="form-error" role="alert">{{ opFormError }}</p>
          <div class="modal-actions"><button class="secondary-button" type="button" :disabled="opSaving" @click="closeOpCreate">Cancelar</button><button class="primary-button" type="submit" :disabled="opSaving">{{ opSaving ? 'Guardando…' : 'Guardar borrador' }}</button></div>
        </form>
      </section>
    </div>

    <div v-if="showOpDetail" class="modal-backdrop" @click.self="closeOpDetail">
      <section class="card modal modal-wide" role="dialog" aria-modal="true" aria-label="Detalle de operación">
        <div class="modal-title"><div><p>MOVIMIENTO</p><h2>Detalle de operación</h2></div><button type="button" :disabled="acting" aria-label="Cerrar" @click="closeOpDetail">×</button></div>
        <div v-if="opDetailLoading" class="page-state" role="status">Cargando detalle…</div>
        <div v-else-if="opDetailError" class="page-state error-state" role="alert">{{ opDetailError }}</div>
        <div v-else-if="selectedOp" class="op-detail">
          <dl class="detail-grid">
            <div><dt>Tipo</dt><dd>{{ operationTypeLabel(selectedOp.operation?.operation_type) }}</dd></div>
            <div><dt>Fecha</dt><dd>{{ selectedOp.operation?.operation_date ?? '—' }}</dd></div>
            <div><dt>Referencia</dt><dd>{{ selectedOp.operation?.reference ?? '—' }}</dd></div>
            <div><dt>Notas</dt><dd>{{ selectedOp.operation?.notes ?? '—' }}</dd></div>
            <div><dt>Estado</dt><dd><span class="badge">{{ operationStatusLabel(selectedOp.operation?.status) }}</span></dd></div>
          </dl>
          <table>
            <thead><tr><th>Producto</th><th>Categoría</th><th>Seguimiento</th><th>Cantidad</th><th>Seriales</th><th>Notas</th></tr></thead>
            <tbody>
              <tr v-for="line in selectedOp.lines ?? []" :key="line.id">
                <td>{{ line.product?.name ?? '—' }}</td>
                <td>{{ line.product ? categoryLabel(line.product.category) : '—' }}</td>
                <td>{{ line.product ? trackingLabel(line.product.tracking_mode) : '—' }}</td>
                <td>{{ line.quantity ?? '—' }}</td>
                <td>{{ Array.isArray(line.serial_numbers) ? line.serial_numbers.join(', ') : '—' }}</td>
                <td>{{ line.notes ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-if="selectedOp.operation?.status === 'draft' && canWriteOperations" class="modal-actions op-actions">
            <button class="secondary-button" type="button" :disabled="acting" @click="askOpAction('cancel')">Cancelar borrador</button>
            <button class="primary-button" type="button" :disabled="acting" @click="askOpAction('confirm')">Confirmar operación</button>
          </div>
          <div v-if="pendingAction" class="confirm-box" role="alert">
            <p v-if="pendingAction === 'confirm'">Esta operación actualizará el inventario y no podrá editarse después. ¿Confirmar?</p>
            <p v-else>¿Cancelar este borrador?</p>
            <div class="modal-actions">
              <button class="secondary-button" type="button" :disabled="acting" @click="cancelOpAction">Volver</button>
              <button class="primary-button" type="button" :disabled="acting" @click="runOpAction">{{ acting ? 'Procesando…' : 'Sí, continuar' }}</button>
            </div>
          </div>
          <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
        </div>
      </section>
    </div>

    <div v-if="showCreate" class="modal-backdrop" @click.self="closeCreate">
      <section class="card modal" role="dialog" aria-modal="true" aria-label="Nuevo producto">
        <div class="modal-title"><div><p>NUEVO REGISTRO</p><h2>Nuevo producto</h2></div><button type="button" :disabled="saving" aria-label="Cerrar" @click="closeCreate">×</button></div>
        <form @submit.prevent="saveProduct">
          <label>Nombre *<input v-model="form.name" required maxlength="200" :disabled="saving" /></label>
          <div class="form-grid">
            <label>Categoría *<select v-model="form.category" :disabled="saving"><option v-for="(label, key) in categories" :key="key" :value="key">{{ label }}</option></select></label>
            <label>Unidad *<input v-model="form.unit" required maxlength="40" :disabled="saving" /></label>
            <label>Fabricante<input v-model="form.manufacturer" maxlength="200" :disabled="saving" /></label>
            <label>Modelo<input v-model="form.model" maxlength="200" :disabled="saving" /></label>
          </div>
          <fieldset><legend>Tipo de control *</legend><label class="radio-option"><input v-model="form.tracking_mode" type="radio" value="serialized" :disabled="saving" /><span><strong>Serializado</strong><small>Cada unidad se controla individualmente por número de serie.</small></span></label><label class="radio-option"><input v-model="form.tracking_mode" type="radio" value="quantity" :disabled="saving" /><span><strong>Por cantidad</strong><small>El stock se controla mediante cantidades y movimientos.</small></span></label></fieldset>
          <label>Nivel mínimo de reposición<input v-model="form.reorder_level" inputmode="decimal" :disabled="saving" /></label>
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <div class="modal-actions"><button class="secondary-button" type="button" :disabled="saving" @click="closeCreate">Cancelar</button><button class="primary-button" type="submit" :disabled="saving">{{ saving ? 'Guardando…' : 'Crear producto' }}</button></div>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inventory-page { width: 100%; min-width: 0; }
.inventory-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 20px; }
.inventory-header h1 { margin: 2px 0 4px; }
.inventory-header p { margin: 0; color: var(--rdx-text-muted); }
.eyebrow, .section-head p, .modal-title p { margin: 0; font-size: 11px; font-weight: 750; letter-spacing: .09em; color: var(--rdx-text-muted); }
.primary-button, .secondary-button { min-height: 40px; padding: 9px 16px; border-radius: var(--rdx-radius-sm); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.primary-button { border: 1px solid var(--rdx-primary); background: var(--rdx-primary); color: var(--rdx-on-primary); }
.secondary-button { border: 1px solid var(--rdx-border); background: var(--rdx-surface); color: var(--rdx-text-strong); }
button:disabled { opacity: .6; cursor: wait; }
.notice { padding: 10px 14px; border-radius: var(--rdx-radius-sm); background: var(--rdx-success-soft); color: var(--rdx-success); font-size: 13px; }
.inventory-sticky { position: sticky; top: var(--rdx-topbar-height, 46px); z-index: 20; background: var(--rdx-background); padding: 12px 0; }
.kpi-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.kpi { display: grid; min-width: 0; padding: 9px 12px; }
.kpi span { font-size: 11px; font-weight: 700; color: var(--rdx-text-muted); }
.kpi strong { margin: 2px 0; color: var(--rdx-text-strong); font-size: 20px; line-height: 1.1; }
.kpi small { color: var(--rdx-text-faint); font-size: 10px; }
.kpi.featured { border-color: color-mix(in srgb, var(--rdx-primary) 30%, var(--rdx-border)); background: var(--rdx-primary-soft); }
.kpi-note { margin: 6px 0 10px; color: var(--rdx-text-muted); font-size: 11px; }
.filters { display: grid; grid-template-columns: 1.5fr repeat(3, 1fr) auto; align-items: end; gap: 12px; padding: 15px; margin-bottom: 0; }
.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 13px 20px; border-top: 1px solid var(--rdx-border); color: var(--rdx-text-muted); font-size: 12px; }
.page-controls { display: flex; align-items: center; gap: 10px; }
.page-label, .page-range { white-space: nowrap; }
.page-label { font-weight: 700; }
.filters label, .modal label { display: grid; gap: 6px; min-width: 0; color: var(--rdx-text-muted); font-size: 12px; font-weight: 650; }
.filters input, .filters select, .modal input, .modal select, .modal textarea { width: 100%; min-height: 40px; padding: 8px 11px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: var(--rdx-surface); color: var(--rdx-text-strong); font: inherit; }
.filter-actions { display: flex; align-items: center; gap: 7px; }
.compact { min-height: 40px; }
.text-button { border: 0; background: transparent; color: var(--rdx-primary); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.product-section { padding: 0; overflow: hidden; }
.section-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--rdx-border); }
.section-head h2 { margin: 3px 0 0; font-size: 18px; }
.section-head > span { padding: 5px 10px; border-radius: 999px; background: var(--rdx-neutral-soft); font-size: 12px; font-weight: 700; }
.page-state { padding: 42px 20px; color: var(--rdx-text-muted); text-align: center; }
.error-state { color: var(--rdx-danger); }
.table-wrapper { width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { padding: 11px 13px; background: var(--rdx-neutral-soft); color: var(--rdx-text-muted); font-size: 10px; letter-spacing: .04em; text-align: left; white-space: nowrap; }
td { padding: 14px 13px; border-top: 1px solid var(--rdx-border); color: var(--rdx-text-muted); vertical-align: middle; }
.product-name { min-width: 150px; }
.product-name strong, .product-name small { display: block; }
.product-name strong, .stock-cell { color: var(--rdx-text-strong); }
.product-name small { margin-top: 3px; color: var(--rdx-text-faint); }
.badge { display: inline-flex; padding: 5px 9px; border-radius: 999px; background: var(--rdx-neutral-soft); color: var(--rdx-text-muted); font-size: 10px; font-weight: 750; white-space: nowrap; }
.badge.control { background: var(--rdx-primary-soft); color: var(--rdx-primary); }
.badge.active { background: var(--rdx-success-soft); color: var(--rdx-success); }
.badge.inactive { background: var(--rdx-warning-soft); color: var(--rdx-warning); }
.detail-link { color: var(--rdx-primary); font-weight: 750; white-space: nowrap; }
.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / .45); }
.modal { width: min(620px, 100%); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 22px; }
.modal-title { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.modal-title h2 { margin: 3px 0 0; }
.modal-title button { border: 0; background: transparent; color: var(--rdx-text-muted); font-size: 24px; cursor: pointer; }
.modal form { display: grid; gap: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.modal fieldset { display: grid; gap: 8px; margin: 0; padding: 0; border: 0; }
.modal legend { margin-bottom: 3px; color: var(--rdx-text-muted); font-size: 12px; font-weight: 700; }
.radio-option { grid-template-columns: auto 1fr !important; align-items: start; padding: 10px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); }
.radio-option input { width: auto; min-height: auto; margin-top: 3px; }
.radio-option span, .radio-option small { display: block; }
.radio-option strong { color: var(--rdx-text-strong); }
.radio-option small { margin-top: 2px; font-weight: 400; }
.form-error { margin: 0; color: var(--rdx-danger); font-size: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 9px; }
@media (max-width: 1100px) { .kpi-grid { grid-template-columns: repeat(3, 1fr); } .filters { grid-template-columns: repeat(2, 1fr); } .filter-actions { align-self: end; } }
@media (max-width: 700px) {   .inventory-header { flex-direction: column; }
  .header-actions { flex-wrap: wrap; } .inventory-sticky { position: static; } .kpi-grid { grid-template-columns: repeat(2, 1fr); } .filters, .form-grid { grid-template-columns: 1fr; } .filter-actions { justify-content: flex-end; } .pagination { flex-direction: column; } }
.tabs { display: flex; gap: 8px; margin: 0 0 16px; }
.tabs button { min-height: 38px; padding: 8px 18px; border: 1px solid var(--rdx-border); border-radius: 999px; background: var(--rdx-surface); color: var(--rdx-text-muted); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.tabs button.active { border-color: var(--rdx-primary); background: var(--rdx-primary-soft); color: var(--rdx-primary); }
.header-actions { display: flex; align-items: center; gap: 10px; }
.modal-wide { width: min(760px, 100%); }
.op-line { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); }
.line-actions { display: flex; justify-content: flex-end; }
.text-button.danger { color: var(--rdx-danger); }
.op-line small, .modal label small { color: var(--rdx-text-muted); font-weight: 400; }
.op-detail { display: grid; gap: 14px; }
.detail-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 0; }
.detail-grid dt { color: var(--rdx-text-muted); font-size: 11px; font-weight: 700; }
.detail-grid dd { margin: 2px 0 0; color: var(--rdx-text-strong); font-size: 13px; }
.op-actions { justify-content: flex-end; margin-top: 4px; }
.confirm-box { padding: 12px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: var(--rdx-neutral-soft); }
.confirm-box p { margin: 0 0 10px; font-size: 13px; }
@media (max-width: 700px) { .detail-grid { grid-template-columns: 1fr; } }
@media (max-width: 440px) { .kpi-grid { grid-template-columns: 1fr; } .modal-actions { flex-direction: column-reverse; } .modal-actions button { width: 100%; } }
</style>
