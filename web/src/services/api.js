const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/+$/, '');
import { getSession } from './supabase.js';

export async function apiFetch(path, options = {}) {
  const session = await getSession();
  const headers = new Headers(options.headers);
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
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
