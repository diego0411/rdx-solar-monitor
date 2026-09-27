const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/+$/, '');
import { getSession } from './supabase.js';

// Lee el body una sola vez como texto y lo interpreta de forma segura.
// Nunca lanza: un body ilegible, vacío o no JSON produce { ok: false, ... }
// para que el llamante conserve siempre el status HTTP real.
async function readBodySafely(response) {
  let text = null;
  try {
    text = await response.text();
  } catch {
    return { ok: false, body: null, detail: null };
  }
  if (!text) return { ok: false, body: null, detail: null };
  try {
    const body = JSON.parse(text);
    return { ok: true, body, detail: body?.error ?? body?.message ?? null };
  } catch {
    return { ok: false, body: text, detail: text };
  }
}

export async function apiFetch(path, options = {}) {
  const session = await getSession();
  if (!session?.access_token) {
    const error = new Error('Sesión no autenticada');
    error.status = 401;
    throw error;
  }
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  // Sin try/catch aquí: AbortError y errores de red deben propagarse intactos.
  const response = await fetch(`${API_URL}/${path.replace(/^\/+/, '')}`, {
    ...options,
    headers,
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    const { body, detail } = await readBodySafely(response);
    const error = new Error(`Error de API: ${response.status}`);
    error.status = response.status;
    error.body = body;
    error.detail = detail;
    throw error;
  }
  const { ok, body, detail } = await readBodySafely(response);
  if (!ok) {
    const error = new Error(`Error de API: ${response.status}`);
    error.status = response.status;
    error.body = body;
    error.detail = detail;
    throw error;
  }
  return body;
}

let myProfilePromise = null;

export function getMyProfile() {
  if (!myProfilePromise) {
    myProfilePromise = apiFetch('/auth/me').catch(error => {
      myProfilePromise = null;
      throw error;
    });
  }
  return myProfilePromise;
}
