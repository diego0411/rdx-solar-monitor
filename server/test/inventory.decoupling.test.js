import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Static guarantees for 026: inventory context independence without touching
// Nexora, client_plants data, users or authorization (no live DB here).
const dir = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter(name => name.startsWith('026'));
assert.deepEqual(files, ['026_decouple_inventory_client_plant.sql']);
const sql = readFileSync(new URL(`../../supabase/migrations/${files[0]}`, import.meta.url), 'utf8');

test('026 reemplaza trigger y RPC con validación independiente', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.enforce_inventory_structure\(\)/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.inventory_transition_serialized_item\(/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.inventory_record_quantity_movement\(/);
});

test('026 no depende de client_plants en inventario', () => {
  assert.doesNotMatch(sql, /FROM public\.client_plants/);
  assert.doesNotMatch(sql, /client_plants AS assignment/);
  assert.match(sql, /FROM public\.clients WHERE id/);
  assert.match(sql, /FROM public\.plants WHERE id/);
});

test('026 no toca Nexora, client_plants, usuarios ni autorización', () => {
  assert.doesNotMatch(sql, /6ef5d4e4-0cbf-460c-b37b-d41dfa1ecda3/);
  assert.doesNotMatch(sql, /UPDATE public\.clients/);
  assert.doesNotMatch(sql, /DELETE FROM public\.client_plants/);
  assert.doesNotMatch(sql, /UPDATE public\.user_profiles/);
  assert.doesNotMatch(sql, /DELETE FROM public\.user_profiles/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.user_profiles/);
  assert.doesNotMatch(sql, /DROP /i);
  assert.doesNotMatch(sql, /ALTER TABLE/i);
});

test('026 permite contexto parcial y conserva máquina de estados', () => {
  assert.match(sql, /cliente solo, planta solo o ambos/);
  assert.match(sql, /IS NOT DISTINCT FROM p_client_id/);
  assert.match(sql, /v_next_status := 'assigned'/);
  assert.match(sql, /v_next_status := 'installed'/);
  assert.match(sql, /v_to_status := 'sold'/);
  assert.match(sql, /v_to_status := 'written_off'/);
  assert.match(sql, /INSUFFICIENT_STOCK/);
});

test('026 exige planta en installed y permite completarla en install', () => {
  assert.match(sql, /installed exige plant_id/);
  assert.match(sql, /v_movement_plant_id := COALESCE\(v_item\.plant_id, p_plant_id\)/);
  assert.match(sql, /se conserva la existente o se completa/);
  assert.match(sql, /plant_id = v_movement_plant_id,/);
});

test('026 exige cliente activo solo en nuevas asociaciones', () => {
  const inactive = sql.match(/MESSAGE = 'INACTIVE_CLIENT'/g) ?? [];
  assert.equal(inactive.length, 4);
  assert.match(sql, /SELECT c\.active INTO v_client_active/);
  assert.match(sql, /Venta desde asignado: el contexto delimita el saldo/);
  assert.match(sql, /el historial con clientes luego desactivados se preserva/);
});
