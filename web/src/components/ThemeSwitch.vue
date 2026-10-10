<script setup>
import { computed, ref, nextTick, useId, onMounted, onBeforeUnmount } from 'vue';
import { useTheme } from '../composables/useTheme.js';

// Selector de apariencia light/dark/auto. Lógica única compartida por la
// topbar (vistas) y el encabezado del Dashboard (topbar oculta allí).
const { preference: themePreference, setThemePreference } = useTheme();
const themeOptions = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
  { value: 'auto', label: 'Automático' },
];
const activeTheme = computed(() => themeOptions.find(option => option.value === themePreference.value));
const menuId = `theme-menu-${useId()}`;
const root = ref(null), trigger = ref(null), menu = ref(null);
const isOpen = ref(false), focusedIndex = ref(0);
const menuPosition = ref({ left: '0px', top: '0px' });

function closeMenu(restoreFocus = false) {
  isOpen.value = false;
  if (restoreFocus) trigger.value?.focus();
}

function positionMenu() {
  if (!trigger.value || !menu.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  const panel = menu.value.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(margin, Math.min(anchor.right - panel.width, window.innerWidth - panel.width - margin));
  const below = anchor.bottom + 6;
  const top = below + panel.height <= window.innerHeight - margin
    ? below : Math.max(margin, anchor.top - panel.height - 6);
  menuPosition.value = { left: `${left}px`, top: `${top}px` };
}

function focusOption(index) {
  focusedIndex.value = (index + themeOptions.length) % themeOptions.length;
  menu.value?.querySelectorAll('[role="menuitemradio"]')[focusedIndex.value]?.focus();
}

async function openMenu(index = themeOptions.findIndex(option => option.value === themePreference.value)) {
  isOpen.value = true;
  focusedIndex.value = index;
  await nextTick();
  if (!isOpen.value) return;
  positionMenu();
  focusOption(index);
}

function toggleMenu() {
  if (isOpen.value) closeMenu();
  else openMenu();
}

function selectTheme(value) {
  setThemePreference(value);
  closeMenu(true);
}

function onTriggerKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openMenu(event.key === 'ArrowDown' ? 0 : themeOptions.length - 1);
  } else if (event.key === 'Escape' && isOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
  }
}

function onMenuKeydown(event) {
  if (event.key === 'Tab') {
    // Dejar que Tab avance desde el botón, sin atrapar el foco en el menú.
    closeMenu(true);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') closeMenu(true);
  else if (event.key === 'Home') focusOption(0);
  else if (event.key === 'End') focusOption(themeOptions.length - 1);
  else focusOption(focusedIndex.value + (event.key === 'ArrowDown' ? 1 : -1));
}

function onOutsideInteraction(event) {
  if (isOpen.value && !root.value?.contains(event.target) && !menu.value?.contains(event.target)) {
    closeMenu();
  }
}

function onViewportChange(event) {
  if (isOpen.value && !menu.value?.contains(event.target)) closeMenu();
}

onMounted(() => {
  document.addEventListener('pointerdown', onOutsideInteraction, true);
  document.addEventListener('focusin', onOutsideInteraction);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutsideInteraction, true);
  document.removeEventListener('focusin', onOutsideInteraction);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
});
</script>

<template>
  <div ref="root" class="theme-switch">
    <button
      ref="trigger"
      class="theme-trigger"
      type="button"
      aria-haspopup="menu"
      :aria-controls="menuId"
      :aria-expanded="String(isOpen)"
      :aria-label="`Tema ${activeTheme.label.toLowerCase()}. Cambiar tema visual`"
      :title="`Tema ${activeTheme.label.toLowerCase()}`"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
        <g v-if="themePreference === 'light'">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2m0 14.6v2.2M4.6 4.6l1.6 1.6m11.6 11.6 1.6 1.6M2.5 12h2.2m14.6 0h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
        </g>
        <path v-else-if="themePreference === 'dark'" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        <g v-else>
          <rect x="3" y="4.5" width="18" height="12" rx="2" />
          <path d="M9 20.5h6M12 16.5v4" />
        </g>
      </svg>
    </button>
    <Teleport to="body">
      <div v-if="isOpen" :id="menuId" ref="menu" class="theme-menu" role="menu" aria-label="Tema visual" :style="menuPosition" @keydown="onMenuKeydown">
        <button
          v-for="(option, index) in themeOptions"
          :key="option.value"
          type="button"
          class="theme-option"
          role="menuitemradio"
          :aria-checked="String(themePreference === option.value)"
          :tabindex="focusedIndex === index ? 0 : -1"
          @focus="focusedIndex = index"
          @click="selectTheme(option.value)"
        >
          <span>{{ option.label }}</span>
          <svg v-if="themePreference === option.value" class="theme-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.theme-switch {
  display: inline-flex;
  flex: 0 0 auto;
}

.theme-trigger {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid var(--rdx-border);
  border-radius: 8px;
  background: var(--rdx-background);
  color: var(--rdx-text-strong);
  cursor: pointer;
}

.theme-trigger:hover,
.theme-trigger[aria-expanded='true'] {
  background: var(--rdx-neutral-soft);
}

.theme-menu {
  position: fixed;
  z-index: 45;
  width: 176px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid var(--rdx-border);
  border-radius: 10px;
  background: var(--rdx-surface);
  color: var(--rdx-text-strong);
  box-shadow: var(--rdx-shadow-md);
}

.theme-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--rdx-text-strong);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.theme-option:hover,
.theme-option[aria-checked='true'] {
  background: var(--rdx-neutral-soft);
}

.theme-option[aria-checked='true'] {
  font-weight: 600;
}

.theme-trigger:focus-visible,
.theme-option:focus-visible {
  outline: 2px solid var(--rdx-focus);
  outline-offset: -2px;
}

.theme-icon,
.theme-check {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
