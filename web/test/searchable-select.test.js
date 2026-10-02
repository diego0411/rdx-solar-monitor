import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { computed, ref, watch } from 'vue';

const source = readFileSync(new URL('../src/components/SearchableSelect.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const code = compileScript(descriptor, { id: 'searchable-select-test' }).content
  .replace(/^import[^;]*;$/gm, '')
  .replace('export default', 'return');

const clients = [
  { id: 'client-1', name: 'NexoraSRL', phone: '70010020', email: 'ventas@nexora.test' },
  { id: 'client-2', name: 'Solar Andina', phone: '71122334', email: 'hola@andina.test' },
  { id: 'client-3', name: 'Energía Sur', phone: null, email: 'contacto@energia.test' },
];

function setup(overrides = {}) {
  const props = {
    modelValue: '', options: clients, placeholder: 'Buscar cliente', ariaLabel: 'Cliente',
    searchFields: ['name', 'phone', 'email'], searchText: null,
    optionValue: option => option.id, primaryText: option => option.name,
    secondaryText: option => [option.phone, option.email].filter(Boolean).join(' · '),
    disabled: false, required: false, maxResults: 8, emptyText: 'Sin resultados',
    ...overrides,
  };
  const emitted = [];
  const deps = { computed, ref, watch, onMounted() {}, onBeforeUnmount() {} };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup(props, {
    expose() {},
    emit: (...args) => emitted.push(args),
  });
  return { view, emitted };
}

function type(view, value) {
  view.handleInput({ target: { value } });
}

test('escribir filtra opciones de inmediato y por múltiples términos', () => {
  const { view } = setup();
  type(view, 'nex ventas');
  assert.deepEqual(view.matchingOptions.value.map(option => option.id), ['client-1']);
});

test('la búsqueda es case-insensitive', () => {
  const { view } = setup();
  type(view, 'ENERGÍA sur');
  assert.deepEqual(view.matchingOptions.value.map(option => option.id), ['client-3']);
});

test('busca Cliente por nombre, teléfono y correo', () => {
  const { view } = setup();
  for (const query of ['Nexora', '70010020', 'ventas@nexora.test']) {
    type(view, query);
    assert.deepEqual(view.matchingOptions.value.map(option => option.id), ['client-1']);
  }
});

test('clic selecciona exactamente el ID de la opción', () => {
  const { view, emitted } = setup();
  view.selectOption(clients[1]);
  assert.deepEqual(emitted[0], ['update:modelValue', 'client-2']);
  assert.equal(view.query.value, 'Solar Andina');
  assert.equal(view.open.value, false);
});

test('ArrowDown y Enter seleccionan la opción activa', () => {
  const { view, emitted } = setup();
  type(view, 'solar');
  view.handleKeydown({ key: 'ArrowDown', preventDefault() {} });
  view.handleKeydown({ key: 'Enter', preventDefault() {} });
  assert.deepEqual(emitted.find(event => event[0] === 'update:modelValue'), [
    'update:modelValue', 'client-2',
  ]);
  assert.equal(view.open.value, false);
});

test('Escape cierra las sugerencias', () => {
  const { view } = setup();
  type(view, 'solar');
  assert.equal(view.open.value, true);
  view.handleKeydown({ key: 'Escape' });
  assert.equal(view.open.value, false);
});

test('sin coincidencias muestra el estado vacío', () => {
  const { view } = setup();
  type(view, 'inexistente');
  assert.deepEqual(view.matchingOptions.value, []);
  assert.match(source, /role="status">\{\{ emptyText \}\}/);
  assert.match(source, /default: 'Sin resultados'/);
});

test('no despliega el catálogo completo al enfocar sin búsqueda', () => {
  const { view } = setup();
  view.handleFocus();
  assert.equal(view.open.value, false);
  assert.deepEqual(view.matchingOptions.value, []);
});
