<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { supabase } from '../services/supabase.js';
import { getMyProfile } from '../services/api.js';
import { invalidateDevicesCatalog, invalidatePlantsCatalog } from '../services/catalog.js';
import ThemeSwitch from '../components/ThemeSwitch.vue';
const router = useRouter();
const route = useRoute();
const showUsers = ref(false);
const showClients = ref(false);
const displayName = ref('Usuario');
const myRole = ref(null);
const myModules = ref([]);
function canSee(module) {
  if (myRole.value === 'rdx_admin' || myRole.value === 'client_admin') return true;
  if (myRole.value !== 'client_user') return false;
  return myModules.value.includes(module);
}

const SIDEBAR_KEY = 'rdx.sidebar.collapsed';
const SECTIONS_KEY = 'rdx.sidebar.sections';

function readStorage(key) {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // Sin persistencia disponible: la navegación sigue funcionando en memoria.
  }
}

const sidebarCollapsed = ref(readStorage(SIDEBAR_KEY) === 'true');

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  writeStorage(SIDEBAR_KEY, String(sidebarCollapsed.value));
}

// UX-02B: drawer móvil (<=720px). En escritorio el botón del encabezado
// alterna el colapso; en móvil abre/cierra el drawer superpuesto.
const MOBILE_QUERY = '(max-width: 720px)';
const isMobile = ref(false);
const mobileNavOpen = ref(false);
const menuButtonRef = ref(null);
const sidebarRef = ref(null);
let mobileMediaQuery = null;
let previousBodyOverflow = '';

function setBodyLocked(locked) {
  try {
    if (typeof document === 'undefined' || !document?.body) return;
    if (locked) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = previousBodyOverflow;
    }
  } catch {
    // Sin DOM disponible: el drawer sigue funcionando sin bloqueo.
  }
}

function setMobileNav(open) {
  mobileNavOpen.value = open;
  setBodyLocked(open);
}

function openMobileNav() {
  setMobileNav(true);
  nextTick(() => {
    try {
      sidebarRef.value?.focus?.();
    } catch {
      // Foco no disponible: el drawer ya es visible y operable.
    }
  });
}

function closeMobileNav(returnFocus = true) {
  setMobileNav(false);
  if (returnFocus) {
    try {
      menuButtonRef.value?.focus?.();
    } catch {
      // Sin botón disponible: nada que enfocar.
    }
  }
}

function onMenuButtonClick() {
  if (isMobile.value) {
    if (mobileNavOpen.value) closeMobileNav();
    else openMobileNav();
  } else {
    toggleSidebar();
  }
}

function onGlobalKeydown(event) {
  if (event?.key === 'Escape' && mobileNavOpen.value) closeMobileNav();
}

// UX-05C D4: contención local del foco en el drawer móvil. Solo actúa con
// el drawer abierto; no registra listeners globales y no interfiere con
// useModalStack (el drawer nunca entra en su pila; Escape ya cede al drawer).
const DRAWER_FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function drawerControls() {
  try {
    if (!sidebarRef.value || typeof sidebarRef.value.querySelectorAll !== 'function') return [];
    return [...sidebarRef.value.querySelectorAll(DRAWER_FOCUSABLE)]
      .filter(el => typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
  } catch {
    return [];
  }
}

function readDrawerActiveElement() {
  try {
    if (typeof document === 'undefined') return null;
    return document.activeElement ?? null;
  } catch {
    return null;
  }
}

function onDrawerKeydown(event) {
  if (!isMobile.value || !mobileNavOpen.value) return;
  if (!event || event.key !== 'Tab') return;
  const controls = drawerControls();
  if (!controls.length) {
    if (typeof event.preventDefault === 'function') event.preventDefault();
    return;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = readDrawerActiveElement();
  let redirect = null;
  if (active === first && event.shiftKey) redirect = last;
  else if (active === last && !event.shiftKey) redirect = first;
  else if (typeof sidebarRef.value?.contains === 'function' ? !sidebarRef.value.contains(active) : active !== sidebarRef.value) {
    redirect = event.shiftKey ? last : first;
  }
  if (redirect) {
    try {
      redirect.focus();
    } catch {
      // Foco no disponible: se conserva el actual.
    }
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
}

function syncMobile(event) {
  const matches = typeof event?.matches === 'boolean'
    ? event.matches
    : (mobileMediaQuery?.matches ?? false);
  isMobile.value = matches;
  if (!matches) setMobileNav(false);
}

const defaultSections = { monitoreo: true, operaciones: true, administracion: true };

function loadSections() {
  try {
    const raw = readStorage(SECTIONS_KEY);
    if (!raw) return { ...defaultSections };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...defaultSections };
    return { ...defaultSections, ...parsed };
  } catch {
    return { ...defaultSections };
  }
}

const openSections = ref(loadSections());

function persistSections() {
  writeStorage(SECTIONS_KEY, JSON.stringify(openSections.value));
}

function toggleSection(name) {
  openSections.value = { ...openSections.value, [name]: !openSections.value[name] };
  persistSections();
}

const routeSections = {
  dashboard: 'monitoreo',
  plants: 'monitoreo',
  map: 'monitoreo',
  devices: 'monitoreo',
  alarms: 'monitoreo',
  'plant-detail': 'monitoreo',
  'device-detail': 'monitoreo',
  maintenance: 'operaciones',
  'maintenance-detail': 'operaciones',
  inventory: 'operaciones',
  'inventory-detail': 'operaciones',
  operations: 'operaciones',
  'operations-detail': 'operaciones',
  users: 'administracion',
  clients: 'administracion',
};

// La sección de la ruta activa siempre queda abierta. Navegar también
// cierra el drawer móvil sin mover el foco (ya hay contenido nuevo).
watch(() => route.name, name => {
  const section = routeSections[name];
  if (section && !openSections.value[section]) {
    openSections.value = { ...openSections.value, [section]: true };
    persistSections();
  }
  if (mobileNavOpen.value) closeMobileNav(false);
}, { immediate: true });

const routeCrumbs = {
  dashboard: { section: 'Monitoreo', label: 'Dashboard' },
  plants: { section: 'Monitoreo', label: 'Plantas' },
  map: { section: 'Monitoreo', label: 'Mapa' },
  devices: { section: 'Monitoreo', label: 'Dispositivos' },
  alarms: { section: 'Monitoreo', label: 'Alarmas' },
  'plant-detail': { section: 'Monitoreo', label: 'Plantas' },
  'device-detail': { section: 'Monitoreo', label: 'Dispositivos' },
  maintenance: { section: 'Operaciones', label: 'Mantenimiento' },
  'maintenance-detail': { section: 'Operaciones', label: 'Mantenimiento' },
  inventory: { section: 'Operaciones', label: 'Inventario' },
  'inventory-detail': { section: 'Operaciones', label: 'Inventario' },
  operations: { section: 'Operaciones', label: 'Solicitudes de materiales' },
  'operations-detail': { section: 'Operaciones', label: 'Solicitudes de materiales' },
  users: { section: 'Administración', label: 'Usuarios' },
  clients: { section: 'Administración', label: 'Clientes' },
};

const breadcrumb = computed(() => routeCrumbs[route.name] ?? { section: '', label: '' });
onMounted(async () => {
  try {
    const me = await getMyProfile();
    myRole.value = me?.profile?.role ?? null;
    myModules.value = Array.isArray(me?.profile?.module_permissions) ? me.profile.module_permissions : [];
    showUsers.value = me?.profile?.role === 'rdx_admin';
    showClients.value = me?.profile?.role === 'rdx_admin';
    displayName.value = me?.profile?.display_name?.trim() || 'Usuario';
  } catch {
    showUsers.value = false;
    showClients.value = false;
  }
});
onMounted(() => {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mobileMediaQuery = window.matchMedia(MOBILE_QUERY);
      syncMobile(mobileMediaQuery);
      if (typeof mobileMediaQuery.addEventListener === 'function') {
        mobileMediaQuery.addEventListener('change', syncMobile);
      }
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', onGlobalKeydown);
    }
  } catch {
    // Sin APIs de ventana: se conserva el comportamiento de escritorio.
  }
});
onUnmounted(() => {
  try {
    if (mobileMediaQuery && typeof mobileMediaQuery.removeEventListener === 'function') {
      mobileMediaQuery.removeEventListener('change', syncMobile);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', onGlobalKeydown);
    }
  } catch {
    // Limpieza no disponible: nada que liberar.
  }
  setBodyLocked(false);
});
const signingOut = ref(false), logoutError = ref('');
async function logout() {
  if (signingOut.value) return;
  signingOut.value = true;
  logoutError.value = '';
  try {
    invalidatePlantsCatalog();
    invalidateDevicesCatalog();
    const result = await supabase?.auth.signOut({ scope: 'local' });
    if (result?.error) throw result.error;
    await router.replace('/login');
  } catch {
    logoutError.value = 'No se pudo cerrar la sesión. Inténtalo de nuevo.';
  } finally { signingOut.value = false; }
}
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'nav-open': mobileNavOpen }">
    <a class="skip-link" href="#main-content">Saltar al contenido</a>
    <aside ref="sidebarRef" class="sidebar" id="primary-sidebar" tabindex="-1" :class="{ collapsed: sidebarCollapsed }" :role="isMobile ? 'dialog' : undefined" :aria-modal="isMobile ? 'true' : undefined" :aria-label="isMobile ? 'Menú de navegación' : undefined" @keydown="onDrawerKeydown">
      <button type="button" class="drawer-close" aria-label="Cerrar menú de navegación" aria-controls="primary-sidebar" @click="closeMobileNav()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      <RouterLink class="brand" to="/" aria-label="RDX Solar Monitor, inicio">
        <span class="brand-mark">RDX</span>
        <span class="brand-name">Solar Monitor</span>
      </RouterLink>
      <nav aria-label="Navegación principal">
        <button type="button" class="nav-heading nav-toggle" :aria-expanded="String(openSections.monitoreo)" @click="toggleSection('monitoreo')">
          <span>Monitoreo</span>
          <svg class="chevron" :class="{ closed: !openSections.monitoreo }" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <div v-show="openSections.monitoreo" class="nav-group">
          <RouterLink v-if="canSee('dashboard')" to="/" class="nav-link" exact-active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" /></svg>
            <span>Dashboard</span>
          </RouterLink>
          <RouterLink v-if="canSee('plants')" to="/plants" class="nav-link" active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V10m0 0C8 10 5 8 5 4c4 0 7 2 7 6Zm0 3c0-5 3-8 8-8 0 5-3 8-8 8Z" /></svg>
            <span>Plantas</span>
          </RouterLink>
          <RouterLink v-if="canSee('plants')" to="/map" class="nav-link" active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 5-2 8 2 5-2v14l-5 2-8-2-5 2V6Zm5-2v14m8-12v14" /></svg>
            <span>Mapa</span>
          </RouterLink>
          <RouterLink v-if="canSee('devices')" to="/devices" class="nav-link" active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 9h8m-8 3h5m-5 3h3" /></svg>
            <span>Dispositivos</span>
          </RouterLink>
          <RouterLink v-if="canSee('devices')" to="/alarms" class="nav-link" active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8ZM9.5 20h5" /></svg>
            <span>Alarmas</span>
          </RouterLink>
        </div>
        <button type="button" class="nav-heading nav-toggle" :aria-expanded="String(openSections.operaciones)" @click="toggleSection('operaciones')">
          <span>Operaciones</span>
          <svg class="chevron" :class="{ closed: !openSections.operaciones }" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
        <div v-show="openSections.operaciones" class="nav-group">
          <RouterLink v-if="canSee('maintenance')" to="/maintenance" class="nav-link" active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7Z" /></svg>
            <span>Mantenimiento</span>
          </RouterLink>
          <RouterLink v-if="canSee('inventory')" to="/inventory" class="nav-link" active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Zm0 0 8 4.5 8-4.5M12 12v9" /></svg>
            <span>Inventario</span>
          </RouterLink>
          <RouterLink v-if="canSee('operations')" to="/operations" class="nav-link" active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6h16v2m-16 0h16v9l-2 4H6l-2-4V8Zm4 3h8" /></svg>
            <span>Solicitudes de materiales</span>
          </RouterLink>
        </div>
        <template v-if="showUsers">
          <button type="button" class="nav-heading nav-heading-admin nav-toggle" :aria-expanded="String(openSections.administracion)" @click="toggleSection('administracion')">
            <span>Administración</span>
            <svg class="chevron" :class="{ closed: !openSections.administracion }" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <div v-show="openSections.administracion" class="nav-group">
            <RouterLink to="/users" class="nav-link" active-class="is-active">
              <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c.7-4 3.4-6 8-6s7.3 2 8 6" /></svg>
              <span>Usuarios</span>
            </RouterLink>
            <RouterLink v-if="showClients" to="/clients" class="nav-link" active-class="is-active">
              <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4V6Zm3 3h4m-4 3h7m3-3h1m-1 3h1" /></svg>
              <span>Clientes</span>
            </RouterLink>
          </div>
        </template>
      </nav>
      <div class="sidebar-account">
        <div class="account-identity">
          <span class="account-avatar" aria-hidden="true">{{ displayName.slice(0, 1).toUpperCase() }}</span>
          <div class="account-details">
            <p class="account-name">{{ displayName }}</p>
            <p class="account-role">{{ showUsers ? 'Administrador' : 'Usuario' }}</p>
          </div>
        </div>
        <p class="account-client">Nexora</p>
        <button class="logout-button" :disabled="signingOut" @click="logout">
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5m4-3 4-4-4-4m4 4H9" /></svg>
          <span>{{ signingOut ? 'Cerrando sesión…' : 'Cerrar sesión' }}</span>
        </button>
        <p v-if="logoutError" class="logout-error" role="alert">{{ logoutError }}</p>
      </div>
    </aside>
    <div v-if="mobileNavOpen" class="nav-backdrop" aria-hidden="true" @click="closeMobileNav(false)"></div>
    <div class="main-area">
      <header class="app-topbar">
        <div class="topbar-left">
          <button ref="menuButtonRef" class="icon-button" type="button" aria-label="Contraer o expandir el menú lateral" aria-controls="primary-sidebar" :aria-expanded="String(isMobile ? mobileNavOpen : !sidebarCollapsed)" @click="onMenuButtonClick">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <nav v-if="breadcrumb.section" class="breadcrumb" aria-label="Ubicación actual">
            <span class="crumb-section">{{ breadcrumb.section }}</span>
            <span class="crumb-separator" aria-hidden="true">›</span>
            <span class="crumb-page" :title="breadcrumb.label">{{ breadcrumb.label }}</span>
          </nav>
        </div>
        <div class="topbar-right">
          <span class="topbar-client">Nexora</span>
          <ThemeSwitch />
        </div>
      </header>
      <main id="main-content" class="main-content" tabindex="-1">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.app-topbar {
  min-height: var(--rdx-topbar-height, 46px);
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--rdx-surface);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.icon-button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--rdx-text-strong);
  cursor: pointer;
}

.icon-button:hover {
  background: var(--rdx-neutral-soft);
}

.icon-button svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.icon-button:focus-visible,
.drawer-close:focus-visible {
  outline: 2px solid var(--rdx-focus);
  outline-offset: 2px;
}

.drawer-close {
  display: none;
}

.nav-backdrop {
  display: none;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
  white-space: nowrap;
}

.crumb-section {
  color: var(--rdx-text-muted);
}

.crumb-separator {
  color: var(--rdx-text-faint);
}

.crumb-page {
  color: var(--rdx-text-strong);
  font-weight: 700;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  margin-left: auto;
}

@media (max-width: 560px) {
  .topbar-client {
    display: none;
  }
}

.nav-group {
  display: grid;
  gap: var(--rdx-space-1);
}

.nav-toggle {
  width: 100%;
  font: inherit;
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nav-toggle:hover {
  color: var(--rdx-sidebar-text);
}

.nav-toggle .chevron {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform var(--rdx-transition);
}

.nav-toggle .chevron.closed {
  transform: rotate(-90deg);
}

@media (min-width: 721px) {
  .app-shell.sidebar-collapsed {
    grid-template-columns: 64px minmax(0, 1fr);
  }

  .sidebar.collapsed {
    padding: 20px 8px 16px;
    gap: 16px;
  }

  .sidebar.collapsed .brand {
    align-items: center;
    padding-inline: 0;
  }

  .sidebar.collapsed .brand-name {
    display: none;
  }

  .sidebar.collapsed .nav-heading {
    display: none;
  }

  .sidebar.collapsed .nav-link {
    justify-content: center;
    padding: 9px 0;
  }

  .sidebar.collapsed .nav-link span {
    display: none;
  }

  .sidebar.collapsed .account-details,
  .sidebar.collapsed .account-client,
  .sidebar.collapsed .logout-button span,
  .sidebar.collapsed .logout-error {
    display: none;
  }

  .sidebar.collapsed .account-identity {
    justify-content: center;
  }

  .sidebar.collapsed .sidebar-account {
    padding-inline: 0;
  }

  .sidebar.collapsed .logout-button {
    justify-content: center !important;
  }
}

@media (max-width: 720px) {
  .app-shell.sidebar-collapsed:not(.nav-open) .sidebar {
    display: none;
  }

  /* Breadcrumb simplificado: solo la vista actual para no recortar la topbar. */
  .crumb-section,
  .crumb-separator {
    display: none;
  }

  .app-shell .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 60;
    width: min(300px, 84vw);
    height: 100vh;
    height: 100dvh;
    overflow-y: auto;
    overflow-x: hidden;
    border-right: 1px solid var(--rdx-sidebar-border);
    border-bottom: 0;
    visibility: hidden;
    transform: translateX(-105%);
    transition: transform var(--rdx-transition), visibility var(--rdx-transition);
  }

  .app-shell.nav-open .sidebar {
    visibility: visible;
    transform: none;
  }

  .app-shell.nav-open .nav-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 55;
    background: rgb(0 0 0 / 45%);
  }

  .drawer-close {
    display: grid;
    place-items: center;
    position: absolute;
    top: 12px;
    right: 12px;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--rdx-sidebar-text);
    cursor: pointer;
  }

  .drawer-close:hover {
    background: var(--rdx-sidebar-hover);
  }

  .drawer-close svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  /* UX-05C D6: el drawer usa una sola columna; la retícula de dos columnas
     de la navegación de escritorio estrecha queda anulada aquí. */
  .app-shell .sidebar nav {
    grid-template-columns: 1fr;
  }

  .app-shell .sidebar .sidebar-account {
    grid-template-columns: 1fr;
  }
}
</style>
