import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// UX-05 D2/D3: botoneras de modales y encabezados en móvil.
// Escritorio intacto; a ≤720px los modales apilan a ancho completo y los
// encabezados envuelven sin desbordar. Solo CSS/layout, sin lógica.

const files = [
  'UsersView',
  'AlarmsView',
  'OperationsView',
  'MaterialRequestDetailView',
  'MaintenanceView',
  'MaintenanceDetailView',
];
const sources = Object.fromEntries(files.map(name =>
  [name, readFileSync(new URL(`../src/views/${name}.vue`, import.meta.url), 'utf8')]));

function styleOf(source) {
  return source.slice(source.indexOf('<style'));
}

test('D2: base de escritorio conserva fila alineada a la derecha', () => {
  for (const name of files) {
    const style = styleOf(sources[name]);
    assert.match(style, /\.modal-actions \{\s*display: flex;\s*justify-content: flex-end;/, `${name} base intacta`);
    assert.ok(!/\.modal-actions[^{]*\{[^}]*column-reverse/.test(
      style.split('@media')[0]), `${name} sin apilado fuera de media`);
  }
});

test('D2: a ≤720px las seis vistas apilan a ancho completo', () => {
  for (const name of files) {
    const style = styleOf(sources[name]);
    const blocks = [...style.matchAll(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]);
    assert.ok(blocks.length > 0, `${name} tiene bloque 720px`);
    assert.ok(blocks.some(block =>
      /\.modal-actions\s*\{\s*flex-direction:\s*column-reverse;\s*\}/.test(block)
      && /\.modal-actions button\s*\{\s*width:\s*100%;\s*\}/.test(block)),
    `${name} apila modal-actions a 100% en móvil`);
  }
});

test('D3: encabezados envuelven a ≤720px sin tocar escritorio', () => {
  const detail = styleOf(sources.MaintenanceDetailView);
  assert.match(detail, /\.header-actions \{\s*display: flex;\s*flex-shrink: 0;\s*gap: 10px;\s*\}/);
  assert.match(detail, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.header-actions \{\s*flex-wrap: wrap;\s*\}/);
  const operations = styleOf(sources.OperationsView);
  assert.match(operations, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.header-actions \{\s*display: flex; flex-wrap: wrap; gap: 10px;\s*\}/);
  assert.ok(!/\.header-actions\s*\{/.test(operations.split('@media')[0]),
    'Operations conserva escritorio sin regla previa de header-actions');
});

test('lógica funcional intacta: textos, eventos y disabled', () => {
  const handlers = {
    UsersView: ['@click="closeForm"', '@click="closeConfirm"', ':disabled="formSaving"'],
    AlarmsView: ['@click="closeDetail"'],
    OperationsView: ['@click="closeForm"', '@click="exportOperations"', ':disabled="formSaving"'],
    MaterialRequestDetailView: ['@click="closeTransitionConfirm"', '@click="closeDeliver"'],
    MaintenanceView: ['@click="closeForm"', ':disabled="formSaving"'],
    MaintenanceDetailView: ['@click="closeEditForm"', '@click="applyDeleteActivity"', ':disabled="deleteSaving"'],
  };
  for (const [name, needles] of Object.entries(handlers)) {
    const template = sources[name].slice(0, sources[name].indexOf('<style'));
    for (const needle of needles) assert.ok(template.includes(needle), `${name}: ${needle}`);
    assert.ok(template.includes('class="modal-actions"'), `${name}: modal-actions en template`);
  }
});
