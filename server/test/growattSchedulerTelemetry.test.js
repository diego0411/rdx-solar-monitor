import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Wiring estático de telemetría Growatt latest/history: server.js arranca
// el listener al importarse, así que se audita el texto fuente.
const source = readFileSync(
  fileURLToPath(new URL('../src/server.js', import.meta.url)),
  'utf8',
);

test('growatt latest/history usan createScheduledSync con label Growatt', () => {
  assert.match(source, /const runGrowattLatestSync = createScheduledSync\(\{/);
  assert.match(source, /name: 'latest', label: 'Growatt', sync: syncGrowattLatest/);
  assert.match(source, /const runGrowattHistorySync = createScheduledSync\(\{/);
  assert.match(source, /name: 'history', label: 'Growatt', sync: syncGrowattHistoryCycle/);
  assert.doesNotMatch(source, /growatt:latest-cycle|growatt:history-cycle/);
});

test('history conserva errores por planta y devuelve contadores de rate limiting', () => {
  assert.match(source, /FREQUENTLY_ACCESS for \$\{plant\.external_plant_id\}/);
  assert.match(source, /Growatt automatic history sync failed for \$\{plant\.external_plant_id\}/);
  assert.match(source, /failed_plants: failedPlants, frequent_access: frequentAccess/);
});

test('sin timeout para los jobs Growatt (semántica skip previa preservada)', () => {
  const latestBlock = source.match(/const runGrowattLatestSync = createScheduledSync\(\{[\s\S]*?\}\);/)?.[0] ?? '';
  const historyBlock = source.match(/const runGrowattHistorySync = createScheduledSync\(\{[\s\S]*?\}\);/)?.[0] ?? '';
  assert.doesNotMatch(latestBlock, /timeoutMs|warnAfterMs/);
  assert.doesNotMatch(historyBlock, /timeoutMs|warnAfterMs/);
});
