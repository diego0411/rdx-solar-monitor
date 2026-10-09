import { computed, ref, watch } from 'vue';
import { clearRdxColorCache } from '../utils/rdxTokens.js';

// UX-01B: preferencia de tema visual. 'light' por defecto; 'auto' sigue al
// sistema vía prefers-color-scheme. Persistencia en rdx.theme.
// ECharts/Leaflet se suscriben en UX-01C vía el evento 'rdx:theme'.
export const THEME_STORAGE_KEY = 'rdx.theme';
export const THEME_PREFERENCES = ['light', 'dark', 'auto'];
const DEFAULT_PREFERENCE = 'light';

const THEME_COLORS = { light: '#174d3c', dark: '#0e1512' };

function readPreference() {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_PREFERENCE;
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_PREFERENCES.includes(raw) ? raw : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

function systemPrefersDark() {
  try {
    if (typeof matchMedia === 'undefined') return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

const preference = ref(readPreference());
const systemDark = ref(systemPrefersDark());

export const effectiveTheme = computed(() =>
  preference.value === 'dark' || (preference.value === 'auto' && systemDark.value)
    ? 'dark'
    : 'light',
);

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  try {
    const meta = document.querySelector?.('meta[name="theme-color"]');
    meta?.setAttribute?.('content', THEME_COLORS[theme] ?? THEME_COLORS.light);
  } catch {
    // Sin head manipulable (tests): el tema visual sigue aplicándose.
  }
  clearRdxColorCache();
  try {
    window.dispatchEvent(new CustomEvent('rdx:theme', { detail: { theme } }));
  } catch {
    // Sin bus de eventos: los gráficos re-renderizan en UX-01C.
  }
}

export function setThemePreference(value) {
  if (!THEME_PREFERENCES.includes(value)) return false;
  preference.value = value;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Sin persistencia disponible: el tema sigue funcionando en memoria.
  }
  return true;
}

let started = false;

export function initTheme() {
  if (started) return;
  started = true;
  applyTheme(effectiveTheme.value);
  watch(effectiveTheme, applyTheme);
  try {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = event => { systemDark.value = event.matches; };
    if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
    else if (typeof query.addListener === 'function') query.addListener(onChange);
  } catch {
    // Sin matchMedia: 'auto' equivale a 'light'.
  }
}

export function useTheme() {
  initTheme();
  return { preference, effectiveTheme, setThemePreference };
}
