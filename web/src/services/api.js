const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/+$/, '');
import { getSession } from './supabase.js';

export async function apiFetch(path, options = {}) {
  const session = await getSession();
  if (!session?.access_token) {
    const error = new Error('Sesión no autenticada');
    error.status = 401;
    throw error;
  }
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);
  const response = await fetch(`${API_URL}/${path.replace(/^\/+/, '')}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    const error = new Error(`Error de API: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
