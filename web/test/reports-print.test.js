import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ECO-04D6: impresión A4 vía window.print() sobre la vista previa vigente.
// Sin dependencias nuevas, sin fetch al imprimir, con paleta clara forzada.

const view = readFileSync(new URL('../src/views/ReportsView.vue', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

test('1: botón visible solo con foto y deshabilitado sin readiness', () => {
  assert.match(view, /<button class="secondary-button" type="button" :disabled="!canPrint" @click="handlePrint">Imprimir \/ Guardar PDF<\/button>/);
  assert.match(view, /const canPrint = computed\(\(\) => preview\.value !== null/);
  assert.match(view, /!previewLoading\.value && !ecoLoading\.value/);
  assert.match(view, /history\.value !== null/);
  assert.match(view, /economicsData\.value !== null && !ecoError\.value/);
});

test('2: window.print solo por acción explícita, con título restaurado', () => {
  assert.equal(view.match(/window\.print\(\)/g)?.length ?? 0, 1);
  assert.match(view, /async function handlePrint\(\)/);
  assert.match(view, /if \(!canPrint\.value\) return;/);
  assert.match(view, /document\.title = `RDX Reporte/);
  assert.match(view, /afterprint/);
  assert.match(view, /function restorePrintState\(\)/);
  const handler = view.slice(view.indexOf('async function handlePrint()'), view.indexOf('function onHistoryLoaded'));
  assert.ok(!handler.includes('apiFetch'), 'imprimir no consulta datos');
});

test('3: gráfico consistente con el tema claro antes de imprimir', () => {
  assert.match(view, /clearRdxColorCache/);
  assert.match(view, /removeAttribute\('data-theme'\)/);
  assert.match(view, /new CustomEvent\('rdx:theme'/);
  assert.match(view, /PRINT_SETTLE_MS/);
  assert.match(view, /setAttribute\('data-theme', 'dark'\)/);
});

test('4: CSS A4, cromo oculto y papel claro forzado', () => {
  assert.match(css, /@page \{ size: A4 portrait;/);
  assert.ok(css.includes('.sidebar, .app-topbar, .skip-link, .nav-backdrop, .drawer-close'), 'cromo oculto');
  assert.ok(css.includes('.reports-view .preview { background: #fff;'), 'papel claro');
  assert.match(view, /\.print-only \{ display: none; \}/);
  assert.match(view, /print-header/);
  assert.match(view, /print-footer/);
  assert.match(view, /break-inside: avoid/);
  assert.match(view, /break-after: avoid/);
});

test('5: encabezado, pie y cobertura diferenciada en la impresión', () => {
  assert.match(view, /RDX Technology/);
  assert.match(view, /Emitido \{\{ generatedAt \}\}/);
  assert.match(view, /Cobertura del gráfico|coverageCounts/);
  assert.match(view, /reportCopy\.publicationWarning/);
  assert.match(view, /no puede considerarse verificado/);
});

test('6: ECO-04D7 bloque gráfico atómico y sin página en blanco', () => {
  assert.match(view, /\.preview :deep\(\.energy-section\) \{ break-inside: avoid; break-before: page; \}/);
  assert.match(css, /\.app-shell \{ display: block; background: #fff; min-height: 0; \}/);
});

test('7: ECO-04D9 canvas proporcional sin recorte derecho en A4', () => {
  assert.match(view, /\.preview :deep\(\.energy-chart > div\) \{ max-width: 100% !important; \}/);
  assert.match(view, /\.preview :deep\(\.energy-chart canvas\) \{ max-width: 100% !important; height: auto !important; \}/);
  assert.ok(!view.includes(':deep(.energy-chart) { height:'), 'contenedor con altura fija (ECO-04D12, sin colapso)');
  assert.ok(!view.includes('overflow: hidden') && !view.includes('overflow:hidden'), 'sin ocultar contenido');
});

test('8: ECO-04D10 advertencias fragmentables, gráfico en página propia', () => {
  assert.ok(!view.includes('.disclaimers, .preview'), 'lista fuera de la regla indivisible');
  assert.match(view, /\.preview h3 \{ break-after: avoid; \}/);
  assert.match(view, /\.kpi, \.credit, \.preview :deep\(\.energy-chart\) \{ break-inside: avoid; \}/);
  assert.match(view, /\.preview :deep\(\.energy-section\) \{ break-inside: avoid; break-before: page; \}/);
});
