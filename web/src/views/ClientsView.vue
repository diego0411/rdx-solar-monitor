<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { getMyProfile } from '../services/api.js';
import {
  createClient,
  listClients,
  setClientStatus,
  updateClient,
} from '../services/clients.js';

const clients = ref([]);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const accessDenied = ref(false);
const controller = new AbortController();

async function loadClients() {
  const data = await listClients({ status: 'all', signal: controller.signal });
  if (!Array.isArray(data)) throw new Error('Respuesta inválida');
  clients.value = data;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const me = await getMyProfile();
    if (me?.profile?.role !== 'rdx_admin') { accessDenied.value = true; return; }
    await loadClients();
  } catch (failure) {
    if (!controller.signal.aborted) {
      if (failure?.status === 403) accessDenied.value = true;
      else error.value = 'No se pudieron cargar los clientes.';
    }
  } finally {
    loading.value = false;
  }
}

function actionMessage(failure, fallback) {
  if (failure?.status === 400) return failure.detail || 'Revisa los datos ingresados.';
  if (failure?.status === 403) return 'No tienes permiso para esta acción.';
  if (failure?.status === 404) return 'El cliente ya no está disponible.';
  if (failure?.status === 409) return failure.detail || 'La operación entra en conflicto con el estado actual.';
  return fallback;
}

const showForm = ref(false);
const editing = ref(null);
const form = ref({ name: '' });
const formError = ref('');
const formSaving = ref(false);

function openCreate() {
  editing.value = null; form.value = { name: '' }; formError.value = ''; showForm.value = true;
}
function openEdit(client) {
  editing.value = client; form.value = { name: client.name }; formError.value = ''; showForm.value = true;
}
function closeForm() {
  if (formSaving.value) return;
  showForm.value = false; editing.value = null; formError.value = '';
}
async function saveForm() {
  if (formSaving.value) return;
  const name = form.value.name.trim();
  if (!name) { formError.value = 'El nombre es obligatorio.'; return; }
  if (name.length > 120) { formError.value = 'El nombre no puede superar 120 caracteres.'; return; }
  formSaving.value = true; formError.value = '';
  try {
    const wasEditing = !!editing.value;
    if (editing.value) await updateClient(editing.value.id, { name }, { signal: controller.signal });
    else await createClient({ name }, { signal: controller.signal });
    await loadClients();
    showForm.value = false; editing.value = null;
    notice.value = wasEditing ? 'Cliente actualizado.' : 'Cliente creado.';
  } catch (failure) {
    if (!controller.signal.aborted) formError.value = actionMessage(failure, 'No se pudo guardar el cliente.');
  } finally { formSaving.value = false; }
}

const confirming = ref(null);
const statusSaving = ref(false);
const statusError = ref('');
function askStatus(client) { confirming.value = client; statusError.value = ''; }
function closeStatus() { if (!statusSaving.value) confirming.value = null; }
async function applyStatus() {
  if (!confirming.value || statusSaving.value) return;
  statusSaving.value = true; statusError.value = '';
  try {
    await setClientStatus(confirming.value.id, !confirming.value.active, { signal: controller.signal });
    await loadClients();
    confirming.value = null;
    notice.value = 'Estado del cliente actualizado.';
  } catch (failure) {
    if (!controller.signal.aborted) statusError.value = actionMessage(failure, 'No se pudo actualizar el estado.');
  } finally { statusSaving.value = false; }
}

onMounted(load);
onUnmounted(() => controller.abort());
</script>

<template>
  <div class="clients-page">
    <header class="page-header clients-header">
      <div><p class="eyebrow">ADMINISTRACIÓN</p><h1>Clientes</h1><p>Gestiona los clientes comerciales del inventario.</p></div>
      <button v-if="!accessDenied" class="primary-button" type="button" @click="openCreate">+ Nuevo cliente</button>
    </header>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <div v-if="loading" class="card page-state" role="status">Cargando clientes…</div>
    <div v-else-if="accessDenied" class="card page-state" role="alert"><strong>Acceso denegado</strong><p>Solo RDX puede administrar clientes.</p></div>
    <div v-else-if="error" class="card page-state error-state" role="alert">{{ error }}</div>
    <section v-else class="card table-card">
      <div v-if="!clients.length" class="page-state">No hay clientes para mostrar.</div>
      <div v-else class="table-wrapper">
        <table><thead><tr><th>Cliente</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
          <tr v-for="client in clients" :key="client.id"><td class="client-name">{{ client.name }}</td><td><span class="badge" :class="client.active ? 'active' : 'inactive'">{{ client.active ? 'Activo' : 'Inactivo' }}</span></td><td><div class="actions"><button class="link-button" type="button" @click="openEdit(client)">Editar</button><button class="link-button" type="button" @click="askStatus(client)">{{ client.active ? 'Desactivar' : 'Activar' }}</button></div></td></tr>
        </tbody></table>
      </div>
    </section>

    <div v-if="showForm" class="modal-backdrop" @click.self="closeForm"><section class="card modal" role="dialog" aria-modal="true" :aria-label="editing ? 'Editar cliente' : 'Nuevo cliente'"><h2>{{ editing ? 'Editar cliente' : 'Nuevo cliente' }}</h2><form @submit.prevent="saveForm"><label>Nombre *<input v-model="form.name" maxlength="120" required :disabled="formSaving" /></label><p v-if="formError" class="form-error" role="alert">{{ formError }}</p><div class="modal-actions"><button class="secondary-button" type="button" :disabled="formSaving" @click="closeForm">Cancelar</button><button class="primary-button" type="submit" :disabled="formSaving">{{ formSaving ? 'Guardando…' : 'Guardar' }}</button></div></form></section></div>

    <div v-if="confirming" class="modal-backdrop" @click.self="closeStatus"><section class="card modal" role="dialog" aria-modal="true" aria-label="Confirmar estado"><h2>{{ confirming.active ? 'Desactivar cliente' : 'Activar cliente' }}</h2><p>{{ confirming.active ? 'El cliente quedará inactivo, pero sus registros de inventario se conservarán.' : 'El cliente volverá a estar disponible para asociar inventario.' }}</p><p v-if="statusError" class="form-error" role="alert">{{ statusError }}</p><div class="modal-actions"><button class="secondary-button" type="button" :disabled="statusSaving" @click="closeStatus">Cancelar</button><button class="primary-button" type="button" :disabled="statusSaving" @click="applyStatus">{{ statusSaving ? 'Guardando…' : 'Confirmar' }}</button></div></section></div>
  </div>
</template>

<style scoped>
.clients-page { width: 100%; min-width: 0; }
.clients-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.clients-header h1 { margin: 3px 0; }
.clients-header p { margin: 0; color: var(--rdx-text-muted); }
.eyebrow { font-size: 11px; font-weight: 750; letter-spacing: .08em; }
.primary-button, .secondary-button { min-height: 40px; padding: 9px 15px; border-radius: var(--rdx-radius-sm); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.primary-button { border: 1px solid var(--rdx-primary); background: var(--rdx-primary); color: #fff; }
.secondary-button { border: 1px solid var(--rdx-border); background: var(--rdx-surface); color: var(--rdx-text-strong); }
button:disabled { opacity: .6; cursor: wait; }
.notice { padding: 10px 14px; border-radius: var(--rdx-radius-sm); background: var(--rdx-success-soft); color: var(--rdx-success); }
.table-card { padding: 0; overflow: hidden; }
.table-wrapper { width: 100%; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { padding: 12px 15px; background: var(--rdx-neutral-soft); color: var(--rdx-text-muted); font-size: 11px; text-align: left; white-space: nowrap; }
td { padding: 14px 15px; border-top: 1px solid var(--rdx-border); color: var(--rdx-text-muted); vertical-align: middle; }
.client-name { color: var(--rdx-text-strong); font-weight: 700; }
.badge { padding: 5px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.badge.active { background: var(--rdx-success-soft); color: var(--rdx-success); }
.badge.inactive { background: var(--rdx-warning-soft); color: var(--rdx-warning); }
.actions { display: flex; flex-wrap: wrap; gap: 4px; min-width: 150px; }
.link-button { border: 0; background: none; color: var(--rdx-primary); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.page-state { padding: 35px 20px; text-align: center; color: var(--rdx-text-muted); }
.error-state, .form-error { color: var(--rdx-danger); }
.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / .45); }
.modal { width: min(480px, 100%); max-height: calc(100dvh - 40px); overflow-y: auto; padding: 22px; }
.modal h2 { margin: 0 0 14px; }
.modal form, .modal label { display: grid; gap: 7px; }
.modal input { width: 100%; min-height: 40px; padding: 9px 11px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-sm); background: var(--rdx-surface); color: var(--rdx-text-strong); font: inherit; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
@media (max-width: 700px) { .clients-header { flex-direction: column; } .modal-actions { flex-direction: column-reverse; } }
</style>
