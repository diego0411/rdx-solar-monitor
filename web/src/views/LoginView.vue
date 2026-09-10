<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { supabase } from '../services/supabase.js';

const router = useRouter();
const email = ref(''), password = ref(''), error = ref(''), loading = ref(false);
async function login() {
  if (loading.value || !supabase) return;
  loading.value = true;
  error.value = '';
  try {
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
    if (authError) {
      error.value = 'No se pudo iniciar sesión. Comprueba tu email y contraseña.';
      return;
    }
    password.value = '';
    await router.replace('/');
  } catch {
    error.value = 'No se pudo conectar. Inténtalo de nuevo.';
  } finally { loading.value = false; }
}
</script>

<template>
  <main class="login-page">
    <section class="card login-card" aria-labelledby="login-title">
      <p class="eyebrow">RDX Solar Monitor</p>
      <h1 id="login-title">Iniciar sesión</h1>
      <p>Accede al monitoreo de tus plantas solares.</p>
      <p v-if="!supabase" role="alert">El acceso aún no está configurado. Contacta con el administrador.</p>
      <form @submit.prevent="login">
        <label for="email">Email</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required :disabled="loading" />
        <label for="password">Contraseña</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required :disabled="loading" />
        <p v-if="error" class="login-error" role="alert">{{ error }}</p>
        <button type="submit" :disabled="loading || !supabase">{{ loading ? 'Iniciando sesión…' : 'Entrar' }}</button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.login-page { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login-card { width: 100%; max-width: 440px; }
h1 { font-size: 28px; }
form { display: grid; gap: 10px; margin-top: 28px; }
label { font-size: 14px; font-weight: 600; }
input { width: 100%; min-width: 0; padding: 12px; margin-bottom: 10px; border: 1px solid #cad8ce; border-radius: 8px; font: inherit; }
button { padding: 12px; border: 0; border-radius: 8px; background: #174d3c; color: white; font: inherit; font-weight: 600; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
input:focus-visible, button:focus-visible { outline: 3px solid #529b79; outline-offset: 3px; }
.login-error { color: #963d2a; font-size: 14px; }
</style>
