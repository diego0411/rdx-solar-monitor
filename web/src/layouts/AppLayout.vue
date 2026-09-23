<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { supabase } from '../services/supabase.js';
import { getMyProfile } from '../services/api.js';
const router = useRouter();
const showUsers = ref(false);
const displayName = ref('Usuario');
onMounted(async () => {
  try {
    const me = await getMyProfile();
    showUsers.value = me?.profile?.role === 'rdx_admin' || me?.profile?.role === 'client_admin';
    displayName.value = me?.profile?.display_name?.trim() || 'Usuario';
  } catch {
    showUsers.value = false;
  }
});
const signingOut = ref(false), logoutError = ref('');
async function logout() {
  if (signingOut.value) return;
  signingOut.value = true;
  logoutError.value = '';
  try {
    const result = await supabase?.auth.signOut({ scope: 'local' });
    if (result?.error) throw result.error;
    await router.replace('/login');
  } catch {
    logoutError.value = 'No se pudo cerrar la sesión. Inténtalo de nuevo.';
  } finally { signingOut.value = false; }
}
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">Saltar al contenido</a>
    <aside class="sidebar">
      <RouterLink class="brand" to="/" aria-label="RDX Solar Monitor, inicio">
        <span class="brand-mark">RDX</span>
        <span class="brand-name">Solar Monitor</span>
      </RouterLink>
      <nav aria-label="Navegación principal">
        <p class="nav-heading">Monitoreo</p>
        <RouterLink to="/" class="nav-link" exact-active-class="is-active">
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" /></svg>
          <span>Dashboard</span>
        </RouterLink>
        <RouterLink to="/plants" class="nav-link" active-class="is-active">
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V10m0 0C8 10 5 8 5 4c4 0 7 2 7 6Zm0 3c0-5 3-8 8-8 0 5-3 8-8 8Z" /></svg>
          <span>Plantas</span>
        </RouterLink>
        <RouterLink to="/map" class="nav-link" active-class="is-active">
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 5-2 8 2 5-2v14l-5 2-8-2-5 2V6Zm5-2v14m8-12v14" /></svg>
          <span>Mapa</span>
        </RouterLink>
        <RouterLink to="/devices" class="nav-link" active-class="is-active">
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 9h8m-8 3h5m-5 3h3" /></svg>
          <span>Dispositivos</span>
        </RouterLink>
        <RouterLink to="/alarms" class="nav-link" active-class="is-active">
          <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8ZM9.5 20h5" /></svg>
          <span>Alarmas</span>
        </RouterLink>
        <template v-if="showUsers">
          <p class="nav-heading nav-heading-admin">Administración</p>
          <RouterLink to="/users" class="nav-link" active-class="is-active">
            <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c.7-4 3.4-6 8-6s7.3 2 8 6" /></svg>
            <span>Usuarios</span>
          </RouterLink>
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
    <div class="main-area">
      <header class="app-topbar">
        <span>Monitoreo energético</span>
        <span class="topbar-client">Nexora</span>
      </header>
      <main id="main-content" class="main-content" tabindex="-1">
        <slot />
      </main>
    </div>
  </div>
</template>
