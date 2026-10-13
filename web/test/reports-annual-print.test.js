import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';

const { descriptor, errors } = parse(
  readFileSync(new URL('../src/views/ReportsView.vue', import.meta.url), 'utf8'),
);
assert.deepEqual(errors, []);
const style = descriptor.styles.map(block => block.content).join('\n');
const noComments = style.replace(/\/\*[\s\S]*?\*\//g, '');
const printBlock = noComments.slice(noComments.indexOf('@media print'));

function rule(selector) {
  const match = printBlock.match(new RegExp(`${selector}\\s*{([^}]*)}`));
  assert.ok(match, `regla print ausente: ${selector}`);
  return match[1];
}

test('ECO-04G4: el gráfico sigue atómico pero sin salto de página forzado', () => {
  const section = rule('\\.preview :deep\\(\\.energy-section\\)');
  assert.match(section, /break-inside:\s*avoid/, 'la tarjeta del gráfico no debe partirse (ECO-04D7)');
  assert.doesNotMatch(section, /break-before:\s*page/, 'el salto forzado aislaba el último aviso (ECO-04G4)');
  assert.match(section, /break-before:\s*auto/, 'el gráfico fluye tras el último aviso si hay desborde');
});

test('ECO-04G4: las advertencias se conservan completas y fragmentables', () => {
  assert.doesNotMatch(printBlock, /disclaimers[^{]*{[^}]*break-inside:\s*avoid/,
    'la lista debe poder fragmentarse sin recortes');
  assert.doesNotMatch(printBlock, /disclaimers[^{]*{[^}]*display:\s*none/,
    'ninguna advertencia puede ocultarse');
  const headings = rule('\\.preview h3');
  assert.match(headings, /break-after:\s*avoid/, 'el titular sigue unido al primer aviso (ECO-04D10)');
});

test('ECO-04G4: el lienzo conserva su escala de impresión sin recortes', () => {
  const canvas = rule('\\.preview :deep\\(\\.energy-chart canvas\\)');
  assert.match(canvas, /max-width:\s*100%/, 'el canvas nunca desborda la columna A4 (ECO-04D9)');
  assert.match(canvas, /height:\s*auto/, 'la altura permanece proporcional, sin deformar');
});

test('ECO-04G4: las reglas de paginación viven solo en print', () => {
  const screen = style.slice(0, style.indexOf('@media print'));
  assert.doesNotMatch(screen, /break-before/, 'la maqueta de pantalla no cambia');
  assert.doesNotMatch(screen, /break-inside:\s*avoid/, 'la maqueta de pantalla no cambia');
});
