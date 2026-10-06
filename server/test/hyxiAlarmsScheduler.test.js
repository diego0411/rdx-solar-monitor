import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Verificación estática del wiring: server.js arranca el listener al
// importarse, así que se audita el texto fuente en vez de ejecutarlo.
// Cubre: scheduler HYXi alarms registrado, intervalo 5 min, uso del
// createScheduledSync existente, sin backfill/seed/manual.
const source = readFileSync(
  fileURLToPath(new URL('../src/server.js', import.meta.url)),
  'utf8',
);

test('9: scheduler HYXi alarms registrado con createScheduledSync', () => {
  assert.match(source, /import \{ createHyxiAlarmSync \} from '\.\/services\/hyxiAlarmSync\.service\.js'/);
  assert.match(source, /const runHyxiAlarmsSync = createScheduledSync\(\{/);
  assert.match(source, /name: 'alarms', sync: createHyxiAlarmSync\(\)/);
});

test('10/11: intervalo 5 min con el ciclo de vida de los demás syncs HYXi', () => {
  assert.match(source, /setInterval\(runSync, HYXI_SYNC_INTERVAL_MS\)/);
  assert.match(source, /runHyxiAlarmsSync,\r?\n/);
  assert.match(source, /const HYXI_SYNC_INTERVAL_MS = 5 \* 60 \* 1000;/);
});

test('12: aislamiento por createScheduledSync (skip si corre, timeout, catch)', () => {
  const scheduled = readFileSync(
    fileURLToPath(new URL('../src/services/scheduledSync.js', import.meta.url)),
    'utf8',
  );
  assert.match(scheduled, /if \(running\)/);
  assert.match(scheduled, /SYNC_TIMEOUT/);
  assert.match(scheduled, /catch \(error\)/);
});

test('16: sin backfill/seed/llamada manual de alarmas', () => {
  assert.doesNotMatch(source, /backfill/i);
  assert.doesNotMatch(source, /syncHyxiAlarms\(\)/);
  assert.doesNotMatch(source, /alterAlarm|subscribe/i);
});
