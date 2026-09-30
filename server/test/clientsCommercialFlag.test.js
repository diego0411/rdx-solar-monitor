import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Static guarantees for 028: commercial flag + fail-safe Nexora marking,
// without touching authorization, user data, history or migrations 001-027
// (no live DB here).
const dir = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter(name => name.startsWith('028'));
assert.deepEqual(files, ['028_clients_commercial_flag.sql']);
const sql = readFileSync(new URL(`../../supabase/migrations/${files[0]}`, import.meta.url), 'utf8');

test('028 agrega is_commercial con default comercial', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_commercial boolean NOT NULL DEFAULT true/);
});

test('028 es fail-safe: exige exactamente una fila Nexora', () => {
  assert.match(sql, /lower\(btrim\(name\)\) = 'nexora'/);
  assert.match(sql, /RAISE EXCEPTION/);
  assert.match(sql, /UPDATE public\.clients SET is_commercial = false/);
});

test('028 no toca auth, usuarios, plantas ni migraciones previas', () => {
  const executable = sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(executable, /user_profiles/);
  assert.doesNotMatch(executable, /client_plants/);
  assert.doesNotMatch(executable, /DELETE FROM/);
  assert.doesNotMatch(executable, /DROP /i);
  assert.doesNotMatch(executable, /ALTER TABLE public\.clients ADD COLUMN IF NOT EXISTS (phone|email)/);
  assert.doesNotMatch(executable, /SET active/);
});
