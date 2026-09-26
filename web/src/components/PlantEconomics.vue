<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch, getMyProfile } from '../services/api.js';
import { compensationValue, creditEstimatedValue } from '../utils/economicPresentation.js';

const props = defineProps({
  plantId: { type: String, required: true },
  period: { type: String, required: true },
  selectedDate: { type: String, required: true },
});

const summary = ref(null);
const tariffs = ref([]);
const loading = ref(false);
const error = ref('');
const tariffError = ref('');
const saving = ref(false);
const canManage = ref(false);
const showConfiguration = ref(false);
const editingId = ref(null);
const form = ref(emptyForm());
const distributors = ['CRE R.L.', 'DELAPAZ', 'ELFEC', 'ELFEO', 'ENDE DELBENI'];
const distributorChoice = ref('');
const categoryChoice = ref('none');
const hasEndDate = ref(false);
let originalPayload = null;
const currency = computed({
  get: () => distributors.includes(distributorChoice.value) ? 'BOB' : form.value.currency,
  set: value => { form.value.currency = value; },
});
const rateUnit = computed(() => `${currency.value === 'BOB' ? 'Bs' : currency.value}/kWh`);

const periodNames = { day: 'Día', week: 'Semana', month: 'Mes', year: 'Año' };
const compensationNames = {
  monetary: 'Compensación monetaria',
  energy_credit: 'Crédito energético',
  none: 'Sin compensación',
  mixed: 'Compensación variable',
};

function emptyForm() {
  return {
    distributor: '',
    tariff_category: '',
    currency: 'BOB',
    purchase_energy_rate: '',
    export_compensation_type: 'none',
    export_energy_rate: '',
    effective_from: props?.selectedDate ?? '',
    effective_to: '',
  };
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function energy(value) {
  return numeric(value)
    ? `${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(value)} kWh`
    : '—';
}

function money(value) {
  if (!numeric(value)) return '—';
  const amount = new Intl.NumberFormat('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return summary.value?.currency === 'BOB' ? `Bs ${amount}` : `${amount} ${summary.value?.currency ?? ''}`.trim();
}

function rate(value, currency = 'BOB') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const formatted = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 4 }).format(Number(value));
  return `${currency === 'BOB' ? 'Bs' : currency} ${formatted}/kWh`;
}

function date(value) {
  if (!value) return 'Sin fecha final';
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00.000Z`));
}

const coverageLabel = computed(() => {
  const coverage = summary.value?.coverage;
  if (!coverage || coverage.status === 'none') return 'Sin datos energéticos para el periodo';
  if (coverage.inconsistent_intervals) return 'Datos inconsistentes: autoconsumo no calculable';
  if (coverage.missing_tariff_intervals) return 'Falta una tarifa aplicable a parte o todo el periodo';
  if (coverage.status === 'partial') return 'Cobertura parcial';
  return 'Datos disponibles; cobertura total no confirmada';
});

const showCredit = computed(() => summary.value
  && ['energy_credit', 'mixed'].includes(summary.value.compensation_type));
const compensation = computed(() => compensationValue(summary.value));
const creditValue = computed(() => creditEstimatedValue(summary.value));

async function loadSummary() {
  if (!props.plantId || !props.selectedDate) return;
  loading.value = true;
  error.value = '';
  try {
    summary.value = await apiFetch(`/plants/${encodeURIComponent(props.plantId)}/economics?period=${encodeURIComponent(props.period)}&startTime=${encodeURIComponent(props.selectedDate)}`);
  } catch {
    summary.value = null;
    error.value = 'No se pudo cargar el resumen económico.';
  } finally {
    loading.value = false;
  }
}

async function loadTariffs() {
  tariffError.value = '';
  try {
    tariffs.value = await apiFetch(`/plants/${encodeURIComponent(props.plantId)}/energy-tariffs`);
  } catch {
    tariffs.value = [];
    tariffError.value = 'No se pudieron cargar las tarifas.';
  }
}

function newTariff() {
  editingId.value = null;
  form.value = { ...emptyForm(), effective_from: props.selectedDate };
  distributorChoice.value = '';
  categoryChoice.value = 'none';
  hasEndDate.value = false;
  originalPayload = null;
  showConfiguration.value = true;
}

function editTariff(tariff) {
  editingId.value = tariff.id;
  form.value = {
    distributor: tariff.distributor ?? '',
    tariff_category: tariff.tariff_category ?? '',
    currency: tariff.currency ?? 'BOB',
    purchase_energy_rate: tariff.purchase_energy_rate ?? '',
    export_compensation_type: tariff.export_compensation_type,
    export_energy_rate: tariff.export_energy_rate ?? '',
    effective_from: tariff.effective_from,
    effective_to: tariff.effective_to ?? '',
  };
  // Preserve legacy names/currencies without silently changing historical data.
  distributorChoice.value = distributors.includes(tariff.distributor) && form.value.currency === 'BOB'
    ? tariff.distributor : tariff.distributor ? 'other' : '';
  categoryChoice.value = tariff.tariff_category ? 'other' : 'none';
  hasEndDate.value = !!tariff.effective_to;
  originalPayload = tariffPayload();
  showConfiguration.value = true;
}

function tariffPayload() {
  return {
    distributor: (distributorChoice.value === 'other' ? form.value.distributor.trim() : distributorChoice.value) || null,
    tariff_category: categoryChoice.value === 'other' ? form.value.tariff_category.trim() || null : null,
    currency: currency.value.trim().toUpperCase(),
    purchase_energy_rate: form.value.purchase_energy_rate === '' ? null : Number(form.value.purchase_energy_rate),
    export_compensation_type: form.value.export_compensation_type,
    export_energy_rate: form.value.export_compensation_type === 'none' || form.value.export_energy_rate === ''
      ? null : Number(form.value.export_energy_rate),
    effective_from: form.value.effective_from,
    effective_to: hasEndDate.value ? form.value.effective_to || null : null,
  };
}

async function saveTariff() {
  if (saving.value) return;
  tariffError.value = '';
  if ((distributorChoice.value === 'other' && !form.value.distributor.trim())
    || (categoryChoice.value === 'other' && !form.value.tariff_category.trim())) {
    tariffError.value = 'Completa los campos personalizados.';
    return;
  }
  const values = tariffPayload();
  // PATCH only changed fields, so closing a historical tariff preserves its data.
  const payload = editingId.value
    ? Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== originalPayload[key]))
    : values;
  if (editingId.value && !Object.keys(payload).length) {
    showConfiguration.value = false;
    return;
  }
  saving.value = true;
  try {
    const path = editingId.value
      ? `/plants/${encodeURIComponent(props.plantId)}/energy-tariffs/${encodeURIComponent(editingId.value)}`
      : `/plants/${encodeURIComponent(props.plantId)}/energy-tariffs`;
    await apiFetch(path, {
      method: editingId.value ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    showConfiguration.value = false;
    await Promise.all([loadTariffs(), loadSummary()]);
  } catch (failure) {
    tariffError.value = failure.status === 409
      ? 'La vigencia se solapa o la tarifa ya vigente solo puede cerrarse.'
      : 'No se pudo guardar la tarifa. Revisa fechas y valores.';
  } finally {
    saving.value = false;
  }
}

watch(() => [props.plantId, props.period, props.selectedDate], loadSummary, { immediate: true });
watch(() => props.plantId, loadTariffs, { immediate: true });

onMounted(async () => {
  try {
    const me = await getMyProfile();
    canManage.value = ['rdx_admin', 'client_admin'].includes(me?.profile?.role);
  } catch {
    canManage.value = false;
  }
});
</script>

<template>
  <section class="card economics-section" aria-labelledby="economics-title">
    <div class="economics-head">
      <div>
        <h2 id="economics-title">Valor económico</h2>
        <p>{{ periodNames[period] }} · estimación basada en energía registrada</p>
      </div>
      <button v-if="canManage" class="economics-button secondary" type="button" @click="newTariff">
        Configurar tarifas
      </button>
    </div>

    <p v-if="loading" class="economics-state" role="status">Calculando resumen económico…</p>
    <p v-else-if="error" class="economics-state error" role="alert">{{ error }}</p>
    <template v-else-if="summary">
      <p class="coverage-note" :class="`coverage-${summary.coverage?.status}`">{{ coverageLabel }}</p>
      <div class="economics-columns">
        <div>
          <h3>Resumen energético</h3>
          <dl class="economics-list">
            <div><dt>Generación</dt><dd>{{ energy(summary.generation_kwh) }}</dd></div>
            <div><dt>Autoconsumo</dt><dd>{{ energy(summary.self_consumption_kwh) }}</dd></div>
            <div><dt>Importación</dt><dd>{{ energy(summary.grid_import_kwh) }}</dd></div>
            <div><dt>Inyección a red</dt><dd>{{ energy(summary.grid_export_kwh) }}</dd></div>
          </dl>
        </div>
        <div>
          <h3>Ahorro por autoconsumo</h3>
          <dl class="economics-list">
            <div><dt>Autoconsumo</dt><dd>{{ energy(summary.self_consumption_kwh) }}</dd></div>
            <div><dt>Tarifa compra</dt><dd>{{ rate(summary.purchase_energy_rate, summary.currency) }}</dd></div>
            <div><dt>Ahorro</dt><dd>{{ money(summary.self_consumption_savings) }}</dd></div>
          </dl>
          <h3>Compensación por inyección</h3>
          <dl class="economics-list">
            <div><dt>Inyección</dt><dd>{{ energy(summary.grid_export_kwh) }}</dd></div>
            <div><dt>Modalidad</dt><dd>{{ compensationNames[summary.compensation_type] ?? 'Sin tarifa configurada' }}</dd></div>
            <div v-if="summary.compensation_type === 'monetary'">
              <dt>Tarifa compensación</dt><dd>{{ rate(summary.export_energy_rate, summary.currency) }}</dd>
            </div>
            <div v-if="summary.compensation_type === 'monetary'">
              <dt>Compensación</dt><dd>{{ money(compensation) }}</dd>
            </div>
            <div v-if="showCredit"><dt>Crédito generado</dt><dd>{{ energy(summary.export_credit_kwh) }}</dd></div>
            <div v-if="showCredit">
              <dt>Valor económico estimado</dt>
              <dd>{{ creditValue === null || creditValue === undefined ? 'No disponible' : money(creditValue) }}</dd>
            </div>
          </dl>
          <h3>Beneficio económico total</h3>
          <dl class="economics-list">
            <div class="benefit"><dt>Total</dt><dd>{{ money(summary.estimated_economic_benefit) }}</dd></div>
          </dl>
          <p class="compensation-label">Ahorro por autoconsumo + compensación o valor estimado de inyección.</p>
        </div>
      </div>
      <p class="economics-disclaimer">El autoconsumo se estima como producción menos exportación. En plantas con batería puede no representar todos los flujos internos.</p>
    </template>

    <div v-if="canManage" class="tariff-history">
      <div class="tariff-title"><h3>Historial de tarifas</h3><span>{{ tariffs.length }}</span></div>
      <p v-if="tariffError && !showConfiguration" class="economics-state error" role="alert">{{ tariffError }}</p>
      <p v-if="!tariffs.length && !tariffError" class="economics-state">No hay tarifas configuradas.</p>
      <div v-for="tariff in tariffs" :key="tariff.id" class="tariff-row">
        <div>
          <strong>{{ date(tariff.effective_from) }} – {{ date(tariff.effective_to) }}</strong>
          <span>{{ tariff.distributor || 'Distribuidor sin especificar' }} · {{ tariff.tariff_category || 'Sin categoría' }}</span>
        </div>
        <div class="tariff-rates">
          <span>Compra {{ rate(tariff.purchase_energy_rate, tariff.currency) }}</span>
          <span>{{ compensationNames[tariff.export_compensation_type] }}</span>
        </div>
        <button class="text-button" type="button" @click="editTariff(tariff)">Editar / cerrar</button>
      </div>
    </div>

    <form v-if="canManage && showConfiguration" class="tariff-form" @submit.prevent="saveTariff">
      <div class="form-head">
        <h3>{{ editingId ? 'Editar o cerrar vigencia' : 'Nueva tarifa' }}</h3>
        <button type="button" class="close-button" aria-label="Cerrar" @click="showConfiguration = false">×</button>
      </div>
      <div class="form-grid">
        <label>Distribuidor
          <select v-model="distributorChoice" :required="!editingId">
            <option value="" :disabled="!editingId">{{ editingId ? 'No especificado' : 'Selecciona un distribuidor' }}</option>
            <option v-for="distributor in distributors" :key="distributor" :value="distributor">{{ distributor }}</option>
            <option value="other">Otro</option>
          </select>
        </label>
        <label>Categoría tarifaria
          <select v-model="categoryChoice">
            <option value="none">No especificada</option>
            <option value="other">Otra categoría</option>
          </select>
        </label>
        <label v-if="distributorChoice === 'other'">Nombre del distribuidor<input v-model="form.distributor" maxlength="120" required /></label>
        <label v-if="categoryChoice === 'other'">Nombre de la categoría<input v-model="form.tariff_category" maxlength="120" required /></label>
        <label>Moneda
          <select v-model="currency" :disabled="distributorChoice !== 'other'" required>
            <option value="BOB">BOB — Boliviano</option>
            <option value="USD">USD — Dólar estadounidense</option>
            <option value="EUR">EUR — Euro</option>
            <option v-if="editingId && !['BOB', 'USD', 'EUR'].includes(currency)" :value="currency">{{ currency }}</option>
          </select>
        </label>
        <label>Tipo de compensación
          <select v-model="form.export_compensation_type">
            <option value="none">Sin compensación</option>
            <option value="energy_credit">Crédito energético</option>
            <option value="monetary">Compensación monetaria</option>
          </select>
        </label>
        <label>Tarifa de compra de energía
          <span class="rate-input"><input v-model="form.purchase_energy_rate" type="number" min="0" step="0.0001" required /><span>{{ rateUnit }}</span></span>
        </label>
        <label v-if="form.export_compensation_type !== 'none'">Tarifa de exportación{{ form.export_compensation_type === 'energy_credit' ? ' (opcional)' : '' }}
          <span class="rate-input"><input v-model="form.export_energy_rate" type="number" min="0" step="0.0001" :required="form.export_compensation_type === 'monetary'" /><span>{{ rateUnit }}</span></span>
        </label>
        <label>Inicio de vigencia<input v-model="form.effective_from" type="date" required /></label>
        <label class="end-date-toggle"><input v-model="hasEndDate" type="checkbox" />Definir fecha de finalización</label>
        <label v-if="hasEndDate">Fin de vigencia<input v-model="form.effective_to" type="date" :min="form.effective_from" required /></label>
      </div>
      <p v-if="tariffError" class="economics-state error" role="alert">{{ tariffError }}</p>
      <div class="form-actions">
        <button type="button" class="economics-button secondary" @click="showConfiguration = false">Cancelar</button>
        <button type="submit" class="economics-button" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar tarifa' }}</button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.economics-section { grid-column: 1 / -1; min-width: 0; padding: 16px; }
.economics-head, .tariff-title, .form-head, .form-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2, h3 { margin: 0; color: var(--rdx-text-strong); }
h2 { font-size: 17px; }
h3 { font-size: 13px; }
.economics-head p, .economics-disclaimer, .compensation-label { margin: 3px 0 0; color: var(--rdx-text-muted); font-size: 11px; line-height: 1.5; }
.coverage-note { margin: 12px 0; padding: 9px 11px; border-radius: var(--rdx-radius-sm); background: var(--rdx-success-soft); color: var(--rdx-success); font-size: 11px; font-weight: 600; }
.coverage-partial, .coverage-none { background: var(--rdx-warning-soft); color: var(--rdx-warning); }
.economics-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.economics-columns > div { padding: 14px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: var(--rdx-surface); }
.economics-list { margin: 8px 0 0; }
.economics-list > div { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--rdx-neutral-soft); }
.economics-list > div:last-child { border-bottom: 0; }
.economics-list dt { color: var(--rdx-text-muted); font-size: 11px; }
.economics-list dd { margin: 0; color: var(--rdx-text-strong); font-size: 12px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.economics-list .benefit { margin-top: 4px; padding: 11px 9px; border: 0; border-radius: var(--rdx-radius-sm); background: var(--rdx-primary-soft); }
.economics-list .benefit dt, .economics-list .benefit dd { color: var(--rdx-primary); font-weight: 700; }
.economics-disclaimer { margin-top: 10px; }
.economics-state { margin: 12px 0 0; color: var(--rdx-text-muted); font-size: 12px; }
.economics-state.error { color: var(--rdx-danger); }
.economics-button { min-height: 34px; padding: 7px 13px; border: 1px solid var(--rdx-primary); border-radius: var(--rdx-radius-sm); background: var(--rdx-primary); color: white; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.economics-button.secondary { background: var(--rdx-surface); color: var(--rdx-primary); }
.economics-button:disabled { opacity: .6; cursor: wait; }
.tariff-history { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--rdx-border); }
.tariff-title span { min-width: 25px; padding: 3px 8px; border-radius: 20px; background: var(--rdx-neutral-soft); color: var(--rdx-text-muted); font-size: 10px; text-align: center; }
.tariff-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto; align-items: center; gap: 12px; margin-top: 8px; padding: 10px 0; border-top: 1px solid var(--rdx-neutral-soft); }
.tariff-row strong, .tariff-row span { display: block; font-size: 11px; }
.tariff-row span { margin-top: 2px; color: var(--rdx-text-muted); }
.tariff-rates { text-align: right; }
.text-button, .close-button { border: 0; background: transparent; color: var(--rdx-primary); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.tariff-form { margin-top: 14px; padding: 14px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-md); background: var(--rdx-background); }
.close-button { font-size: 21px; line-height: 1; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.form-grid label { display: grid; gap: 5px; color: var(--rdx-text-muted); font-size: 10px; font-weight: 600; }
.form-grid > * { min-width: 0; }
.rate-input { display: flex; align-items: center; gap: 8px; }
.rate-input input { width: 100%; flex: 1; }
.rate-input > span { flex-shrink: 0; }
.form-grid .end-date-toggle { display: flex; align-items: center; grid-column: 1 / -1; gap: 8px; }
.form-grid input, .form-grid select { min-width: 0; height: 36px; padding: 0 9px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: var(--rdx-surface); color: var(--rdx-text); font: inherit; font-size: 12px; }
.form-actions { justify-content: flex-end; margin-top: 12px; }
@media (max-width: 767px) {
  .economics-head { align-items: flex-start; flex-direction: column; }
  .economics-columns, .form-grid { grid-template-columns: 1fr; }
  .tariff-row { grid-template-columns: 1fr; }
  .tariff-rates { text-align: left; }
}
</style>
