const cache = new Map();

function resolve(name, fallback = '') {
  if (!cache.has(name)) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    cache.set(name, value || fallback);
  }
  return cache.get(name);
}

export function rdxColor(name, fallback) {
  return resolve(name, fallback);
}

// UX-01A: invalida la caché para que un futuro cambio de tema (UX-01B)
// resuelva de nuevo los tokens. Sin efecto sobre el comportamiento actual.
export function clearRdxColorCache() {
  cache.clear();
}

export const CHART_SERIES_COLORS = ['#d08a22', '#447bb1', '#9070ac'];