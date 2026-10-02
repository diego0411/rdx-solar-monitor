<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

let nextId = 0;

const props = defineProps({
  modelValue: { default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Escribir para buscar...' },
  ariaLabel: { type: String, default: '' },
  searchFields: { type: Array, default: () => [] },
  searchText: { type: Function, default: null },
  optionValue: { type: Function, default: option => option?.id },
  primaryText: { type: Function, default: option => option?.name ?? '' },
  secondaryText: { type: Function, default: () => '' },
  disabled: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  maxResults: { type: Number, default: 8 },
  emptyText: { type: String, default: 'Sin resultados' },
});

const emit = defineEmits(['update:modelValue', 'select']);

const root = ref(null);
const input = ref(null);
const query = ref('');
const open = ref(false);
const activeIndex = ref(-1);
const id = `searchable-select-${++nextId}`;
const listboxId = `${id}-listbox`;

const selectedOption = computed(() => props.options.find(
  option => props.optionValue(option) === props.modelValue,
) ?? null);

function optionSearchText(option) {
  if (props.searchText) return props.searchText(option);
  return props.searchFields.map(field => option?.[field]).filter(Boolean).join(' ');
}

const matchingOptions = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const limit = Number.isFinite(props.maxResults) && props.maxResults > 0
    ? Math.floor(props.maxResults)
    : 8;
  return props.options.filter(option => {
    const haystack = String(optionSearchText(option) ?? '').toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  }).slice(0, limit);
});

const activeDescendant = computed(() => (
  open.value && activeIndex.value >= 0 ? `${id}-option-${activeIndex.value}` : undefined
));

watch(selectedOption, option => {
  query.value = option ? String(props.primaryText(option) ?? '') : '';
}, { immediate: true });

watch(matchingOptions, options => {
  if (!options.length) activeIndex.value = -1;
  else if (activeIndex.value >= options.length) activeIndex.value = options.length - 1;
});

function handleInput(event) {
  query.value = event.target.value;
  if (selectedOption.value) emit('update:modelValue', '');
  activeIndex.value = -1;
  open.value = query.value.trim() !== '';
}

function handleFocus() {
  if (!selectedOption.value && query.value.trim()) open.value = true;
}

function selectOption(option) {
  emit('update:modelValue', props.optionValue(option));
  emit('select', option);
  query.value = String(props.primaryText(option) ?? '');
  open.value = false;
  activeIndex.value = -1;
}

function clearSelection() {
  emit('update:modelValue', '');
  query.value = '';
  open.value = false;
  activeIndex.value = -1;
  input.value?.focus();
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    open.value = false;
    activeIndex.value = -1;
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  if (!open.value && query.value.trim()) open.value = true;
  if (!matchingOptions.value.length) return;
  if (event.key === 'Enter') {
    if (activeIndex.value >= 0) {
      event.preventDefault();
      selectOption(matchingOptions.value[activeIndex.value]);
    }
    return;
  }
  event.preventDefault();
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  const last = matchingOptions.value.length - 1;
  if (activeIndex.value < 0) activeIndex.value = direction > 0 ? 0 : last;
  else activeIndex.value = (activeIndex.value + direction + matchingOptions.value.length)
    % matchingOptions.value.length;
}

function close() {
  open.value = false;
  activeIndex.value = -1;
}

function handleDocumentPointerDown(event) {
  if (root.value && !root.value.contains(event.target)) close();
}

onMounted(() => document.addEventListener('pointerdown', handleDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleDocumentPointerDown));

defineExpose({ close, focus: () => input.value?.focus() });
</script>

<template>
  <div ref="root" class="searchable-select" :class="{ disabled, open }">
    <div class="searchable-control">
      <input
        :id="id"
        ref="input"
        :value="query"
        type="text"
        role="combobox"
        autocomplete="off"
        :aria-label="ariaLabel || placeholder"
        :placeholder="placeholder"
        :disabled="disabled"
        :required="required"
        :aria-required="required"
        :aria-expanded="open"
        :aria-controls="listboxId"
        :aria-activedescendant="activeDescendant"
        @input="handleInput"
        @focus="handleFocus"
        @keydown="handleKeydown"
      />
      <button
        v-if="query && !disabled"
        class="clear-button"
        type="button"
        aria-label="Limpiar selección"
        @click="clearSelection"
      >
        ×
      </button>
    </div>
    <div v-if="open" :id="listboxId" class="searchable-results" role="listbox">
      <button
        v-for="(option, index) in matchingOptions"
        :id="`${id}-option-${index}`"
        :key="optionValue(option)"
        class="searchable-option"
        :class="{ active: index === activeIndex, selected: optionValue(option) === modelValue }"
        type="button"
        role="option"
        :aria-selected="optionValue(option) === modelValue"
        @mousedown.prevent
        @click="selectOption(option)"
        @mouseenter="activeIndex = index"
      >
        <strong>{{ primaryText(option) }}</strong>
        <span v-if="secondaryText(option)">{{ secondaryText(option) }}</span>
      </button>
      <p v-if="!matchingOptions.length" class="empty-result" role="status">{{ emptyText }}</p>
    </div>
  </div>
</template>

<style scoped>
.searchable-select {
  position: relative;
  min-width: 0;
}

.searchable-control {
  position: relative;
}

.searchable-control input {
  width: 100%;
  min-height: 42px;
  padding: 10px 38px 10px 12px;
  border: 1px solid var(--rdx-border);
  border-radius: 8px;
  background: var(--rdx-surface);
  color: var(--rdx-text-strong);
  font: inherit;
  box-sizing: border-box;
  outline: none;
}

.searchable-control input:hover:not(:disabled) {
  border-color: var(--rdx-text-muted);
}

.searchable-control input:focus {
  border-color: var(--rdx-accent);
  box-shadow: 0 0 0 3px var(--rdx-primary-soft);
}

.searchable-control input:disabled {
  cursor: not-allowed;
  opacity: .65;
}

.clear-button {
  position: absolute;
  top: 50%;
  right: 7px;
  display: grid;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  transform: translateY(-50%);
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rdx-text-muted);
  font-size: 20px;
  cursor: pointer;
}

.clear-button:hover,
.clear-button:focus-visible {
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-strong);
}

.searchable-results {
  position: absolute;
  z-index: 60;
  top: calc(100% + 5px);
  right: 0;
  left: 0;
  max-height: 280px;
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--rdx-border);
  border-radius: 10px;
  background: var(--rdx-surface);
  box-shadow: 0 12px 28px rgb(15 23 42 / .16);
}

.searchable-option {
  display: grid;
  width: 100%;
  gap: 3px;
  padding: 10px 11px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--rdx-text-strong);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.searchable-option:hover,
.searchable-option.active {
  background: var(--rdx-neutral-soft);
}

.searchable-option.selected {
  background: var(--rdx-primary-soft);
}

.searchable-option strong {
  font-size: 13px;
}

.searchable-option span,
.empty-result {
  color: var(--rdx-text-muted);
  font-size: 12px;
}

.empty-result {
  margin: 0;
  padding: 13px 11px;
}
</style>
