<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { apiFetch, getMyProfile } from '../services/api.js';
import { theoreticalPanelCapacityKwp } from '../utils/installationDetails.js';

const props = defineProps({
  plantId: { type: String, required: true },
  plant: { type: Object, required: true },
  devices: { type: Array, default: () => [] },
});

const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };
const statusNames = {
  online: 'En línea', offline: 'Sin conexión', alarm: 'Alarma',
  inactive: 'Inactivo', unknown: 'Desconocido',
};
const details = ref(null);
const form = ref(emptyForm());
const loading = ref(true);
const saving = ref(false);
const editing = ref(false);
const canManage = ref(false);
const error = ref('');

function emptyForm() {
  return {
    installed_at: '', panel_manufacturer: '', panel_model: '', panel_count: '',
    panel_power_w: '', orientation: '', tilt_degrees: '',
  };
}

function toForm(value = {}) {
  return Object.fromEntries(Object.keys(emptyForm()).map(key => [key, value[key] ?? '']));
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function number(value, unit = '', digits = 2) {
  if (!numeric(value)) return '—';
  return `${new Intl.NumberFormat('es-BO', { maximumFractionDigits: digits }).format(value)}${unit ? ` ${unit}` : ''}`;
}

function dateTime(value) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : '—';
}

function calendarDate(value) {
  return value
    ? new Intl.DateTimeFormat('es-BO', { dateStyle: 'medium', timeZone: 'UTC' })
      .format(new Date(`${value}T00:00:00.000Z`))
    : '—';
}

const providerName = computed(() => providerNames[props.plant.provider] ?? props.plant.provider);
const automaticPlantRows = computed(() => [
  ['Proveedor', providerName.value],
  ['Capacidad instalada', numeric(props.plant.capacity_kwp) ? number(props.plant.capacity_kwp, 'kWp') : null],
  ['Tipo de planta', props.plant.plant_type],
  ['Dirección', props.plant.address],
  ['Coordenadas', numeric(props.plant.latitude) && numeric(props.plant.longitude)
    ? `${number(props.plant.latitude, '', 5)}, ${number(props.plant.longitude, '', 5)}` : null],
  ['Zona horaria', props.plant.timezone],
  ['Creación en plataforma', props.plant.platform_created_at
    ? calendarDate(props.plant.platform_created_at) : null],
].filter(([, value]) => value !== null && value !== undefined && value !== ''));

const manualRows = computed(() => details.value ? [
  ['Fecha de instalación', details.value.installed_at ? calendarDate(details.value.installed_at) : null],
  ['Fabricante de panel', details.value.panel_manufacturer],
  ['Modelo de panel', details.value.panel_model],
  ['Cantidad de paneles', details.value.panel_count],
  ['Potencia por panel', numeric(details.value.panel_power_w) ? number(details.value.panel_power_w, 'W') : null],
  ['Orientación', details.value.orientation],
  ['Inclinación', numeric(details.value.tilt_degrees) ? number(details.value.tilt_degrees, '°') : null],
].filter(([, value]) => value !== null && value !== undefined && value !== '') : []);

const theoreticalCapacity = computed(() => theoreticalPanelCapacityKwp(
  Number(details.value?.panel_count), Number(details.value?.panel_power_w),
));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    details.value = await apiFetch(`/plants/${encodeURIComponent(props.plantId)}/installation-details`);
    form.value = toForm(details.value);
  } catch {
    details.value = null;
    error.value = 'No se pudo cargar la configuración de instalación.';
  } finally {
    loading.value = false;
  }
}

function startEditing() {
  form.value = toForm(details.value);
  editing.value = true;
}

function cancelEditing() {
  form.value = toForm(details.value);
  editing.value = false;
  error.value = '';
}

function nullableNumber(value) {
  return value === '' || value === null ? null : Number(value);
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    details.value = await apiFetch(`/plants/${encodeURIComponent(props.plantId)}/installation-details`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installed_at: form.value.installed_at || null,
        panel_manufacturer: form.value.panel_manufacturer.trim() || null,
        panel_model: form.value.panel_model.trim() || null,
        panel_count: nullableNumber(form.value.panel_count),
        panel_power_w: nullableNumber(form.value.panel_power_w),
        orientation: form.value.orientation.trim() || null,
        tilt_degrees: nullableNumber(form.value.tilt_degrees),
      }),
    });
    form.value = toForm(details.value);
    editing.value = false;
  } catch {
    error.value = 'No se pudo guardar. Revisa los valores ingresados.';
  } finally {
    saving.value = false;
  }
}

watch(() => props.plantId, load, { immediate: true });
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
  <section class="card installation-section" aria-labelledby="installation-title">
    <div class="installation-head">
      <div>
        <h2 id="installation-title">Información de instalación</h2>
        <p>Ficha técnica de la planta y configuración registrada.</p>
      </div>
      <button v-if="canManage && !editing" type="button" class="secondary-button" @click="startEditing">Editar</button>
    </div>

    <div class="installation-columns">
      <div>
        <h3>Información automática</h3>
        <p class="source-note">Datos proporcionados por {{ providerName }}.</p>
        <dl class="detail-list">
          <div v-for="row in automaticPlantRows" :key="row[0]"><dt>{{ row[0] }}</dt><dd>{{ row[1] }}</dd></div>
        </dl>
        <div v-if="devices.length" class="technical-devices">
          <article v-for="device in devices" :key="device.id" class="technical-device">
            <strong>{{ device.name || device.model || device.device_type || 'Dispositivo' }}</strong>
            <dl class="device-details">
              <div v-if="device.model"><dt>Modelo</dt><dd>{{ device.model }}</dd></div>
              <div v-if="device.serial_number"><dt>Serial</dt><dd>{{ device.serial_number }}</dd></div>
              <div v-if="device.device_type"><dt>Tipo</dt><dd>{{ device.device_type }}</dd></div>
              <div v-if="device.rated_power_w != null"><dt>Potencia nominal</dt><dd>{{ number(device.rated_power_w, 'W') }}</dd></div>
              <div v-if="device.status"><dt>Estado</dt><dd>{{ statusNames[device.status] ?? device.status }}</dd></div>
              <div v-if="device.software_version"><dt>Firmware</dt><dd>{{ device.software_version }}</dd></div>
              <div v-if="device.hardware_version"><dt>Hardware</dt><dd>{{ device.hardware_version }}</dd></div>
              <div v-if="device.last_data_at"><dt>Última comunicación</dt><dd>{{ dateTime(device.last_data_at) }}</dd></div>
            </dl>
          </article>
        </div>
      </div>

      <div>
        <h3>Configuración de instalación</h3>
        <p class="source-note">Información registrada manualmente.</p>
        <p v-if="loading" class="installation-state" role="status">Cargando configuración…</p>
        <p v-else-if="error && !editing" class="installation-state error" role="alert">{{ error }}</p>
        <form v-else-if="editing" class="installation-form" @submit.prevent="save">
          <label>Fecha de instalación<input v-model="form.installed_at" type="date" :disabled="saving"></label>
          <label>Fabricante de panel<input v-model="form.panel_manufacturer" maxlength="160" :disabled="saving"></label>
          <label>Modelo de panel<input v-model="form.panel_model" maxlength="160" :disabled="saving"></label>
          <label>Cantidad de paneles<input v-model.number="form.panel_count" type="number" min="1" step="1" :disabled="saving"></label>
          <label>Potencia por panel (W)<input v-model.number="form.panel_power_w" type="number" min="0.01" step="0.01" :disabled="saving"></label>
          <label>Orientación<input v-model="form.orientation" maxlength="160" :disabled="saving"></label>
          <label>Inclinación (°)<input v-model.number="form.tilt_degrees" type="number" min="0" max="90" step="0.1" :disabled="saving"></label>
          <p v-if="error" class="installation-state error" role="alert">{{ error }}</p>
          <div class="form-actions">
            <button type="button" class="secondary-button" :disabled="saving" @click="cancelEditing">Cancelar</button>
            <button type="submit" class="primary-button" :disabled="saving">{{ saving ? 'Guardando…' : 'Guardar' }}</button>
          </div>
        </form>
        <template v-else>
          <dl v-if="manualRows.length" class="detail-list">
            <div v-for="row in manualRows" :key="row[0]"><dt>{{ row[0] }}</dt><dd>{{ row[1] }}</dd></div>
            <div v-if="theoreticalCapacity != null"><dt>Potencia teórica de paneles</dt><dd>{{ number(theoreticalCapacity, 'kWp') }}</dd></div>
          </dl>
          <p v-else class="installation-state">Todavía no se registró información manual.</p>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.installation-section { grid-column: 1 / -1; padding: 18px; min-width: 0; }
.installation-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 16px; }
h2, h3 { margin: 0; color: var(--rdx-text-strong); }
h2 { font-size: 17px; } h3 { font-size: 13px; }
.installation-head p, .source-note { margin: 3px 0 0; color: var(--rdx-text-muted); font-size: 11px; }
.installation-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
.detail-list, .device-details { margin: 10px 0 0; }
.detail-list > div, .device-details > div { display: grid; grid-template-columns: minmax(120px, .9fr) minmax(0, 1.1fr); gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--rdx-neutral-soft); }
dt { color: var(--rdx-text-muted); font-size: 11px; } dd { margin: 0; overflow-wrap: anywhere; color: var(--rdx-text-strong); font-size: 11px; font-weight: 600; }
.technical-devices { display: grid; gap: 9px; margin-top: 14px; }
.technical-device { padding: 11px; border: 1px solid var(--rdx-neutral-soft); border-radius: var(--rdx-radius-sm); background: var(--rdx-background); }
.technical-device strong { color: var(--rdx-text-strong); font-size: 12px; }
.device-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
.installation-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.installation-form label { display: grid; gap: 5px; color: var(--rdx-text); font-size: 11px; font-weight: 600; }
.installation-form input { min-width: 0; padding: 9px 10px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: var(--rdx-surface); color: var(--rdx-text-strong); font: inherit; }
.installation-form input:focus { outline: 2px solid var(--rdx-primary-soft); border-color: var(--rdx-primary); }
.form-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; }
.primary-button, .secondary-button { padding: 8px 12px; border: 1px solid var(--rdx-primary); border-radius: var(--rdx-radius-sm); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.primary-button { background: var(--rdx-primary); color: #fff; } .secondary-button { background: var(--rdx-surface); color: var(--rdx-primary); }
.primary-button:disabled, .secondary-button:disabled { opacity: .6; cursor: default; }
.installation-state { margin: 12px 0 0; color: var(--rdx-text-muted); font-size: 12px; }
.installation-state.error { color: var(--rdx-danger); }
@media (max-width: 900px) { .installation-columns { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .installation-head { align-items: flex-start; } .installation-form, .device-details { grid-template-columns: 1fr; } .detail-list > div, .device-details > div { grid-template-columns: 1fr; gap: 2px; } }
</style>
