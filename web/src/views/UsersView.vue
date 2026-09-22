<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getMyProfile } from '../services/api.js';
import { listUsers, createUser, updateUser, setUserStatus } from '../services/users.js';
import { listClients } from '../services/clients.js';

const roleNames = { client_admin: 'Administrador', client_user: 'Usuario' };

const users = ref([]);
const loading = ref(true);
const error = ref('');
const myRole = ref(null);
const accessDenied = ref(false);

const search = ref('');
const statusFilter = ref('all');
const roleFilter = ref('all');

const showForm = ref(false);
const editing = ref(null);
const form = ref({ display_name: '', email: '', role: 'client_user', client_id: '' });
const formError = ref('');
const formSaving = ref(false);
const clients = ref([]);
const clientsLoading = ref(false);
const clientsError = ref('');

const created = ref(null);
const copyState = ref('');

const confirming = ref(null);
const statusSaving = ref(false);

const controller = new AbortController();

const canManageRoles = computed(() => myRole.value === 'rdx_admin');

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  return users.value.filter(user => {
    if (statusFilter.value === 'active' && !user.active) return false;
    if (statusFilter.value === 'inactive' && user.active) return false;
    if (canManageRoles.value && roleFilter.value !== 'all' && user.role !== roleFilter.value) return false;
    if (term && !`${user.display_name ?? ''} ${user.email ?? ''}`.toLowerCase().includes(term)) return false;
    return true;
  });
});

function formatDate(value) {
  if (!value) return 'Sin datos';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin datos';
  return new Intl.DateTimeFormat('es-BO', { dateStyle: 'short' }).format(date);
}

function apiMessage(error, fallback) {
  if (error?.status === 403) return 'No tienes permiso para esta acción.';
  if (error?.status === 404) return 'El usuario ya no está disponible.';
  if (error?.status === 409) return 'El correo ya está registrado.';
  return fallback;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const me = await getMyProfile({ signal: controller.signal });
    myRole.value = me?.profile?.role ?? null;
    if (myRole.value !== 'rdx_admin' && myRole.value !== 'client_admin') {
      accessDenied.value = true;
      return;
    }
    const data = await listUsers({ signal: controller.signal });
    if (!Array.isArray(data)) throw new Error('Respuesta inválida');
    users.value = data;
  } catch (failure) {
    if (!controller.signal.aborted) {
      if (failure?.status === 403) accessDenied.value = true;
      else error.value = 'No se pudieron cargar los usuarios. Comprueba la conexión y vuelve a intentarlo.';
    }
  } finally {
    loading.value = false;
  }
}

async function openCreate() {
  editing.value = null;
  form.value = { display_name: '', email: '', role: 'client_user', client_id: '' };
  formError.value = '';
  showForm.value = true;
  if (canManageRoles.value) {
    clientsLoading.value = true;
    clientsError.value = '';
    try {
      const data = await listClients({ signal: controller.signal });
      clients.value = Array.isArray(data) ? data : [];
    } catch (failure) {
      if (!controller.signal.aborted) clientsError.value = 'No se pudieron cargar los clientes.';
    } finally {
      clientsLoading.value = false;
    }
  }
}

function openEdit(user) {
  editing.value = user;
  form.value = { display_name: user.display_name ?? '', email: user.email ?? '', role: user.role };
  formError.value = '';
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  editing.value = null;
  formError.value = '';
  formSaving.value = false;
}

async function saveForm() {
  if (formSaving.value) return;
  formError.value = '';
  const displayName = form.value.display_name.trim();
  if (!displayName) {
    formError.value = 'El nombre es obligatorio.';
    return;
  }
  formSaving.value = true;
  try {
    if (editing.value) {
      const payload = { display_name: displayName };
      if (canManageRoles.value && form.value.role !== editing.value.role) payload.role = form.value.role;
      const updated = await updateUser(editing.value.id, payload, { signal: controller.signal });
      users.value = users.value.map(user => (user.id === updated.id ? updated : user));
      closeForm();
    } else {
      const payload = { display_name: displayName, email: form.value.email.trim() };
      if (canManageRoles.value) {
        payload.role = form.value.role;
        if (!form.value.client_id) {
          formError.value = 'Selecciona un cliente.';
          formSaving.value = false;
          return;
        }
        payload.client_id = form.value.client_id;
      }
      const result = await createUser(payload, { signal: controller.signal });
      users.value = [stripSecret(result), ...users.value];
      closeForm();
      if (result?.temporary_password) {
        created.value = { email: result.email, password: result.temporary_password };
      }
    }
  } catch (failure) {
    if (!controller.signal.aborted) formError.value = apiMessage(failure, 'No se pudo guardar el usuario.');
  } finally {
    formSaving.value = false;
  }
}

function stripSecret(result) {
  if (!result || typeof result !== 'object') return result;
  const { temporary_password, ...rest } = result;
  return rest;
}

async function copyPassword() {
  if (!created.value?.password) return;
  try {
    await navigator.clipboard.writeText(created.value.password);
    copyState.value = 'Contraseña copiada.';
  } catch {
    copyState.value = 'No se pudo copiar automáticamente. Selecciónala manualmente.';
  }
}

function closeCreated() {
  created.value = null;
  copyState.value = '';
}

function askStatus(user) {
  confirming.value = user;
}

function closeConfirm() {
  if (statusSaving.value) return;
  confirming.value = null;
}

async function applyStatus() {
  const user = confirming.value;
  if (!user || statusSaving.value) return;
  statusSaving.value = true;
  try {
    const updated = await setUserStatus(user.id, !user.active, { signal: controller.signal });
    users.value = users.value.map(item => (item.id === updated.id ? updated : item));
    confirming.value = null;
  } catch (failure) {
    if (!controller.signal.aborted) error.value = apiMessage(failure, 'No se pudo actualizar el estado.');
  } finally {
    statusSaving.value = false;
  }
}

onMounted(load);
onUnmounted(() => controller.abort());
</script>

<template>
  <header class="page-header">
    <div>
      <p class="eyebrow">Administración</p>
      <h1>Usuarios</h1>
      <p>Administra el acceso de los usuarios al portal.</p>
    </div>
    <button class="primary-button" type="button" @click="openCreate">+ Nuevo usuario</button>
  </header>

  <div v-if="loading" class="card" role="status">Cargando usuarios…</div>

  <div v-else-if="accessDenied" class="card" role="alert">
    <strong>Acceso denegado</strong>
    <p>Tu perfil no tiene permiso para administrar usuarios.</p>
  </div>

  <div v-else-if="error && !users.length" class="card" role="alert">{{ error }}</div>

  <template v-else>
    <form class="filters" @submit.prevent>
      <label>
        Buscar
        <input v-model="search" type="search" placeholder="Nombre o correo" />
      </label>
      <label>
        Estado
        <select v-model="statusFilter">
          <option value="all">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </label>
      <label v-if="canManageRoles">
        Rol
        <select v-model="roleFilter">
          <option value="all">Todos</option>
          <option value="client_admin">Administrador cliente</option>
          <option value="client_user">Usuario cliente</option>
        </select>
      </label>
    </form>

    <p v-if="error" class="card" role="alert">{{ error }}</p>

    <p class="results-count" role="status">{{ filtered.length }} de {{ users.length }} usuarios</p>

    <div v-if="!users.length" class="card empty-state">No hay usuarios para mostrar.</div>

    <div v-else-if="!filtered.length" class="card empty-state">No se encontraron usuarios.</div>

    <div v-else class="table-wrapper">
      <table class="users-table">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Correo</th>
            <th>Rol</th>
            <th>Estado</th>
            <th>Fecha de creación</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in filtered" :key="user.id">
            <td class="user-name">{{ user.display_name || 'Sin nombre' }}</td>
            <td>{{ user.email || 'Sin datos' }}</td>
            <td>{{ roleNames[user.role] ?? user.role }}</td>
            <td>
              <span class="badge" :class="user.active ? 'state-online' : 'state-offline'">
                {{ user.active ? 'Activo' : 'Inactivo' }}
              </span>
            </td>
            <td class="date-cell">{{ formatDate(user.created_at) }}</td>
            <td class="actions-cell">
              <button class="link-button" type="button" @click="openEdit(user)">Editar</button>
              <button class="link-button" type="button" @click="askStatus(user)">
                {{ user.active ? 'Inhabilitar' : 'Activar' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>

  <div v-if="showForm" class="modal-backdrop" @click.self="closeForm">
    <section class="card modal" role="dialog" aria-modal="true" :aria-label="editing ? 'Editar usuario' : 'Nuevo usuario'">
      <h2>{{ editing ? 'Editar usuario' : 'Nuevo usuario' }}</h2>
      <form @submit.prevent="saveForm">
        <label for="user-name">Nombre</label>
        <input id="user-name" v-model="form.display_name" type="text" maxlength="120" required :disabled="formSaving" />
        <template v-if="!editing">
          <label for="user-email">Correo</label>
          <input id="user-email" v-model="form.email" type="email" required :disabled="formSaving" />
        </template>
        <template v-if="canManageRoles">
          <label for="user-role">Rol</label>
          <select id="user-role" v-model="form.role" :disabled="formSaving">
            <option value="client_user">Usuario</option>
            <option value="client_admin">Administrador</option>
          </select>
        </template>
        <p v-else class="muted">Rol fijo: Usuario</p>
        <template v-if="canManageRoles && !editing">
          <label for="user-client">Cliente</label>
          <select id="user-client" v-model="form.client_id" required :disabled="formSaving || clientsLoading">
            <option value="" disabled>Selecciona un cliente</option>
            <option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }}</option>
          </select>
          <p v-if="clientsLoading" class="muted" role="status">Cargando clientes…</p>
          <p v-else-if="clientsError" class="form-error" role="alert">{{ clientsError }}</p>
          <p v-else-if="!clients.length" class="muted">No hay clientes activos disponibles.</p>
        </template>
        <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
        <div class="modal-actions">
          <button class="secondary-button" type="button" :disabled="formSaving" @click="closeForm">Cancelar</button>
          <button
            class="primary-button"
            type="submit"
            :disabled="formSaving || (canManageRoles && !editing && (clientsLoading || !!clientsError || !clients.length))"
          >
            {{ formSaving ? 'Guardando…' : editing ? 'Guardar' : 'Crear' }}
          </button>
        </div>
      </form>
    </section>
  </div>

  <div v-if="created" class="modal-backdrop" @click.self="closeCreated">
    <section class="card modal" role="dialog" aria-modal="true" aria-label="Usuario creado">
      <h2>Usuario creado</h2>
      <p>Correo:<br /><strong>{{ created.email }}</strong></p>
      <p>Contraseña temporal:<br /><strong class="temp-password">{{ created.password }}</strong></p>
      <div class="modal-actions">
        <button class="secondary-button" type="button" @click="closeCreated">Cerrar</button>
        <button class="primary-button" type="button" @click="copyPassword">Copiar contraseña</button>
      </div>
      <p v-if="copyState" class="muted" role="status">{{ copyState }}</p>
      <p class="muted">Guarda esta contraseña ahora. Por seguridad no volverá a mostrarse.</p>
    </section>
  </div>

  <div v-if="confirming" class="modal-backdrop" @click.self="closeConfirm">
    <section class="card modal" role="dialog" aria-modal="true" aria-label="Confirmar estado">
      <h2>{{ confirming.active ? 'Inhabilitar usuario' : 'Activar usuario' }}</h2>
      <p v-if="confirming.active">El usuario perderá acceso al portal hasta que vuelva a ser activado.</p>
      <p v-else>El usuario recuperará el acceso al portal.</p>
      <div class="modal-actions">
        <button class="secondary-button" type="button" :disabled="statusSaving" @click="closeConfirm">Cancelar</button>
        <button class="primary-button" type="button" :disabled="statusSaving" @click="applyStatus">
          {{ statusSaving ? 'Guardando…' : confirming.active ? 'Inhabilitar' : 'Activar' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: var(--rdx-text-muted); }
h1 { margin: 4px 0; }
h2 { margin: 0 0 12px; font-size: 18px; }
.primary-button { padding: 10px 16px; border: 0; border-radius: 8px; background: var(--rdx-primary); color: white; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
.primary-button:disabled { opacity: 0.6; cursor: default; }
.secondary-button { padding: 10px 16px; border-radius: 8px; border: 1px solid var(--rdx-border); background: var(--rdx-surface); color: var(--rdx-text-strong); font: inherit; font-weight: 600; cursor: pointer; }
.link-button { border: 0; background: none; padding: 4px 6px; color: var(--rdx-accent); font: inherit; font-weight: 600; cursor: pointer; }
.filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.filters label { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: var(--rdx-text-muted); }
.filters input, .filters select { padding: 9px 12px; border-radius: 8px; font: inherit; }
.results-count { font-size: 13px; color: var(--rdx-text-muted); }
.empty-state { text-align: center; padding: 32px 20px; }
.table-wrapper { width: 100%; overflow-x: auto; }
.users-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.users-table th { padding: 12px 16px; background: var(--rdx-neutral-soft); color: var(--rdx-text-muted); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-align: left; white-space: nowrap; }
.users-table td { padding: 14px 16px; border-top: 1px solid var(--rdx-border); color: var(--rdx-text-muted); vertical-align: middle; }
.user-name { color: var(--rdx-text-strong); font-weight: 600; }
.date-cell { white-space: nowrap; }
.actions-cell { white-space: nowrap; }
.badge { display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 20px; font-weight: 600; font-size: 12px; }
.badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.modal-backdrop { position: fixed; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(0 0 0 / 0.45); z-index: 50; }
.modal { width: 100%; max-width: 440px; }
.modal form { display: grid; gap: 8px; }
.modal label { font-size: 13px; font-weight: 600; }
.modal input, .modal select { padding: 10px 12px; border-radius: 8px; font: inherit; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
.form-error { color: var(--rdx-danger); font-size: 13px; }
.muted { font-size: 13px; color: var(--rdx-text-muted); }
.temp-password { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
@media (max-width: 720px) {
  .page-header { flex-direction: column; }
  .users-table th:nth-child(5), .users-table td:nth-child(5) { display: none; }
}
</style>
