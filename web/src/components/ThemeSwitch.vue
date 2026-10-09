<script setup>
import { useTheme } from '../composables/useTheme.js';

// Selector de apariencia light/dark/auto. Lógica única compartida por la
// topbar (vistas) y el encabezado del Dashboard (topbar oculta allí).
const { preference: themePreference, setThemePreference } = useTheme();
const themeOptions = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'auto', label: 'Automático' },
];
</script>

<template>
  <div class="theme-switch" role="group" aria-label="Tema visual">
    <button
      v-for="option in themeOptions"
      :key="option.value"
      type="button"
      :aria-pressed="String(themePreference === option.value)"
      :aria-label="`Tema ${option.label.toLowerCase()}`"
      :title="`Tema ${option.label.toLowerCase()}`"
      @click="setThemePreference(option.value)"
    >
      <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
        <g v-if="option.value === 'light'">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2m0 14.6v2.2M4.6 4.6l1.6 1.6m11.6 11.6 1.6 1.6M2.5 12h2.2m14.6 0h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
        </g>
        <path v-else-if="option.value === 'dark'" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        <g v-else>
          <rect x="3" y="4.5" width="18" height="12" rx="2" />
          <path d="M9 20.5h6M12 16.5v4" />
        </g>
      </svg>
      <span class="theme-label">{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.theme-switch {
  display: flex;
  flex-direction: row;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--rdx-border);
  border-radius: 10px;
  background: var(--rdx-background);
}

.theme-switch button {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 34px;
  padding: 5px 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--rdx-text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.theme-switch button:hover {
  color: var(--rdx-text-strong);
}

.theme-switch button[aria-pressed='true'] {
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-strong);
  box-shadow: none;
}

.theme-switch button:focus-visible {
  outline: 2px solid var(--rdx-focus);
  outline-offset: 2px;
}

.theme-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.theme-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
