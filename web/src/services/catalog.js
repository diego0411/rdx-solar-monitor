import { apiFetch } from './api.js';
import { getSession } from './supabase.js';

// Catálogo compartido {id,name} de plantas para vistas de referencia
// (Alarmas, Mantenimiento, Operaciones, Inventario). Solo datos de
// referencia: jamás telemetría, alarmas, estados ni históricos.
//
// - Solo memoria (sin localStorage): desaparece al recargar.
// - TTL 10 min: altas/renombres de planta solo ocurren vía sincronizadores.
// - Single-flight: peticiones concurrentes comparten una sola descarga.
// - Identidad: asociado al usuario autenticado; cambio de usuario o logout
//   invalida. La señal del llamante solo cancela SU espera, nunca la
//   descarga compartida.
// - Se entrega una copia por llamante: ninguna vista puede mutar el caché.

export const PLANTS_CATALOG_TTL_MS = 10 * 60 * 1000;

let cache = { userId: undefined, at: 0, data: null, promise: null };

function projectPlants(rows) {
  const list = (Array.isArray(rows) ? rows : []).map(row => ({
    id: row?.id ?? null,
    name: row?.name ?? row?.id ?? null,
  }));
  for (const entry of list) Object.freeze(entry);
  return Object.freeze(list);
}

function snapshot(data) {
  return data.map(entry => ({ ...entry }));
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

async function currentUserId() {
  try {
    const session = await getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function fetchFresh() {
  const rows = await apiFetch('/plants');
  return projectPlants(rows);
}

export async function getPlantsCatalog({ signal } = {}) {
  const userId = await currentUserId();
  if (cache.userId !== userId) {
    cache = { userId, at: 0, data: null, promise: null };
  }
  const fresh = cache.data !== null && (Date.now() - cache.at) < PLANTS_CATALOG_TTL_MS;
  if (!fresh && cache.promise === null) {
    // Slot generacional: si logout, cambio de usuario o invalidación
    // reemplazan el objeto caché mientras la descarga vuela, la respuesta
    // tardía se entrega a sus llamantes pero jamás repuebla el caché nuevo.
    const slot = cache;
    slot.promise = fetchFresh().then(
      data => {
        if (cache === slot) {
          slot.data = data;
          slot.at = Date.now();
          slot.promise = null;
        }
        return data;
      },
      error => {
        if (cache === slot) slot.promise = null;
        throw error;
      },
    );
  }
  const source = fresh ? Promise.resolve(cache.data) : cache.promise;
  if (!signal) {
    const data = await source;
    return snapshot(data);
  }
  if (signal.aborted) return Promise.reject(abortError());
  const data = await Promise.race([
    source,
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    }),
  ]);
  return snapshot(data);
}

export function invalidatePlantsCatalog() {
  cache = { userId: cache.userId, at: 0, data: null, promise: null };
}
