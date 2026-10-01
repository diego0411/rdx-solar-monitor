import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Static guarantees for 030: module permissions column + catalog CHECK +
// compatible backfill, without touching legacy auth tables (no live DB here).
const dir = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter(name => name.startsWith('030'));
assert.deepEqual(files, ['030_user_module_permissions.sql']);
const sql = readFileSync(new URL(`../../supabase/migrations/${files[0]}`, import.meta.url), 'utf8');

test('030 agrega module_permissions con default vacío', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS module_permissions text\[\] NOT NULL DEFAULT '\{\}'/);
});

test('030 admite exactamente el catálogo canónico incluido reports', () => {
  assert.match(sql, /ARRAY\['dashboard', 'plants', 'devices', 'maintenance', 'inventory', 'reports'\]/);
});

test('030 backfill otorga los 5 módulos actuales a client_* existentes', () => {
  const executable = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.match(executable, /ARRAY\['dashboard', 'plants', 'devices', 'maintenance', 'inventory'\]/);
  assert.match(executable, /WHERE role IN \('client_admin', 'client_user'\)/);
  assert.doesNotMatch(executable, /rdx_admin/);
  const backfill = executable.slice(executable.indexOf('UPDATE public.user_profiles'), executable.indexOf('DO $$'));
  assert.doesNotMatch(backfill, /'reports'/);
});

test('030 no toca legacy ni migraciones previas', () => {
  const executable = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(executable, /user_plants/);
  assert.doesNotMatch(executable, /client_plants/);
  assert.doesNotMatch(executable, /DROP /i);
  assert.doesNotMatch(executable, /DELETE FROM/);
  assert.doesNotMatch(executable, /nexora/i);
});
