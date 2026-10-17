import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contrato estático de 036 (devices_status_check + standby) sin DB viva.
// Patrón heredado de inventory.operations033.test.js: verifica estructura SQL,
// NO ejecuta transacciones ni simula PostgreSQL.
const sql = readFileSync(
  new URL('../../supabase/migrations/036_devices_status_standby.sql', import.meta.url),
  'utf8',
);

test('036 admite los seis estados en devices_status_check', () => {
  assert.match(
    sql,
    /CHECK \(status IN \('online', 'offline', 'alarm', 'inactive', 'unknown', 'standby'\)\)/,
  );
});

test('036 preserva los cinco estados existentes', () => {
  for (const status of ['online', 'offline', 'alarm', 'inactive', 'unknown']) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  assert.match(sql, /'standby'/);
});

test('036 es idempotente: DROP CONSTRAINT IF EXISTS previo al ADD', () => {
  assert.match(sql, /DROP CONSTRAINT IF EXISTS devices_status_check/);
  assert.match(sql, /ADD CONSTRAINT devices_status_check/);
  assert.ok(
    sql.indexOf('DROP CONSTRAINT IF EXISTS devices_status_check')
      < sql.indexOf('ADD CONSTRAINT devices_status_check'),
    'el DROP debe preceder al ADD',
  );
});

test('036 alcance mínimo: solo devices, sin tocar otras tablas ni RLS', () => {
  assert.match(sql, /ALTER TABLE public\.devices /);
  assert.doesNotMatch(sql, /plants_status_check/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.(?!devices)/);
  assert.doesNotMatch(sql, /UPDATE|DELETE FROM|INSERT INTO/);
  assert.doesNotMatch(sql, /ROW LEVEL SECURITY|POLICY/);
  assert.doesNotMatch(sql, /CASCADE/);
});
