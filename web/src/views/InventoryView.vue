<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getMyProfile } from '../services/api.js';
import { createInventoryProduct, listInventoryProducts } from '../services/inventory.js';
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

onMounted(async () => {
  try {
    const me = await getMyProfile();
    role.value = me?.profile?.role ?? null;
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
        <button v-if="!filteredProducts.length" class="secondary-button" type="button" :disabled="exporting || !filteredProducts.length" @click="exportInventory">
          <span v-if="exporting">Generando…</span>
          <span v-else>Exportar Excel</span>
        </button>
        <button v-if="canWrite" class="primary-button" type="button" @click="openCreate">+ Nuevo producto</button>
      </div>
    </header>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>

    <div class="inventory-sticky">
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

    <section class="card product-section">
      <div class="section-head"><div><p>CATÁLOGO</p><h2>Productos</h2></div><span>{{ products.length }}</span></div>
      <div v-if="loading" class="page-state" role="status">Consultando inventario…</div>
      <div v-else-if="error" class="page-state error-state" role="alert">{{ error }}</div>
      <div v-else-if="!filteredProducts.length" class="page-state">No hay productos para los filtros seleccionados.</div>
      <div v-else class="table-wrapper">
        <table>
          <thead><tr><th>Producto</th><th>Categoría</th><th>Fabricante / Modelo</th><th>Control</th><th>Disponible</th><th>Despachado</th><th>Asignado</th><th>Instalado</th><th>Stock físico</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>
            <tr v-for="product in pagedProducts" :key="product.id">
              <td class="product-name"><strong>{{ product.name }}</strong><small>{{ product.unit }}</small></td>
              <td>{{ categoryLabel(product.category) }}</td>
              <td>{{ manufacturerModel(product) }}</td>
              <td><span class="badge control">{{ trackingLabel(product.tracking_mode) }}</span></td>
              <td>{{ formatDecimal(product.summary?.available) }}</td>
              <td>{{ formatDecimal(product.summary?.dispatched) }}</td>
              <td>{{ formatDecimal(product.summary?.assigned) }}</td>
              <td>{{ formatDecimal(product.summary?.installed) }}</td>
              <td class="stock-cell">{{ formatDecimal(product.summary?.physical_stock) }}</td>
              <td><span class="badge" :class="product.active ? 'active' : 'inactive'">{{ product.active ? 'Activo' : 'Inactivo' }}</span></td>
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
.primary-button { border: 1px solid var(--rdx-primary); background: var(--rdx-primary); color: #fff; }
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
@media (max-width: 700px) { .inventory-header { flex-direction: column; } .inventory-sticky { position: static; } .kpi-grid { grid-template-columns: repeat(2, 1fr); } .filters, .form-grid { grid-template-columns: 1fr; } .filter-actions { justify-content: flex-end; } .pagination { flex-direction: column; } }
@media (max-width: 440px) { .kpi-grid { grid-template-columns: 1fr; } .modal-actions { flex-direction: column-reverse; } .modal-actions button { width: 100%; } }
</style>
