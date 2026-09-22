<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { supabase } from '../services/supabase.js';
const router = useRouter();
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
        <RouterLink to="/" class="nav-link" exact-active-class="is-active">Dashboard</RouterLink>
        <RouterLink to="/plants" class="nav-link" active-class="is-active">Plantas</RouterLink>
        <RouterLink to="/map" class="nav-link" active-class="is-active">Mapa</RouterLink>
        <RouterLink to="/devices" class="nav-link" active-class="is-active">Dispositivos</RouterLink>
        <RouterLink to="/alarms" class="nav-link" active-class="is-active">Alarmas</RouterLink>
      </nav>
      <div>
        <button class="logout-button" :disabled="signingOut" @click="logout">{{ signingOut ? 'Cerrando sesión…' : 'Cerrar sesión' }}</button>
        <p v-if="logoutError" role="alert">{{ logoutError }}</p>
      </div>
      <p class="sidebar-note">Portal de monitoreo solar</p>
    </aside>
    <main id="main-content" class="main-content" tabindex="-1">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.logout-button { width: 100%; border: 1px solid var(--rdx-border-strong); border-radius: 8px; padding: 10px 14px; background: var(--rdx-surface); color: var(--rdx-primary); font: inherit; cursor: pointer; }
.logout-button:disabled { opacity: .6; cursor: default; }
</style>
