import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contrato estático de 033 (operaciones de inventario V1) sin DB viva.
// Patrón heredado de inventory.decoupling.test.js: verifica estructura SQL,
// NO ejecuta transacciones ni simula PostgreSQL.
const sql = readFileSync(
  new URL('../../supabase/migrations/033_inventory_operations.sql', import.meta.url),
  'utf8',
);

function bodyOf(fnName) {
  const startRe = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fnName}\\(`,
  );
  const start = sql.search(startRe);
  assert.notEqual(start, -1, `no se encontró la función ${fnName}`);
  const tail = sql.slice(start);
  const end = tail.indexOf('$$;');
  assert.notEqual(end, -1, `cuerpo sin terminar en ${fnName}`);
  return tail.slice(0, end);
}

test('033 define tipos V1 IN/ADJUST_IN/ADJUST_OUT sin RETURN', () => {
  assert.match(
    sql,
    /CHECK \(operation_type IN \('IN', 'ADJUST_IN', 'ADJUST_OUT'\)\)/,
  );
  assert.doesNotMatch(sql, /operation_type IN \([^)]*'RETURN'/);
  assert.doesNotMatch(sql, /WHEN 'RETURN'/);
});

test('033 create no muta stock/items/movements', () => {
  const body = bodyOf('inventory_operation_create');
  assert.match(body, /INSERT INTO public\.inventory_operations/);
  assert.match(body, /INSERT INTO public\.inventory_operation_lines/);
  assert.doesNotMatch(body, /INSERT INTO public\.inventory_movements/);
  assert.doesNotMatch(body, /INSERT INTO public\.inventory_items/);
  assert.doesNotMatch(body, /\bCOMMIT\b/);
});

test('033 mapea quantity IN/ADJUST_IN/ADJUST_OUT', () => {
  const body = bodyOf('inventory_operation_confirm');
  assert.match(body, /WHEN 'IN' THEN 'in'/);
  assert.match(body, /WHEN 'ADJUST_IN' THEN 'adjust_in'/);
  assert.match(body, /ELSE 'adjust_out'/);
});

test('033 serialized solo admite IN en create y confirm', () => {
  const create = bodyOf('inventory_operation_create');
  const confirm = bodyOf('inventory_operation_confirm');
  assert.match(create, /p_operation_type <> 'IN'/);
  assert.match(confirm, /v_operation\.operation_type <> 'IN'/);
  assert.match(create, /INVALID_TRACKING_MODE/);
  assert.match(confirm, /INVALID_TRACKING_MODE/);
});

test('033 propaga refs de operación a movements/items', () => {
  assert.match(
    sql,
    /ADD COLUMN inventory_operation_id uuid/,
  );
  assert.match(
    sql,
    /ADD COLUMN inventory_operation_line_id uuid/,
  );
  assert.match(sql, /INVENTORY_OPERATION_LINE_REQUIRED/);
  assert.match(sql, /INVENTORY_OPERATION_LINE_MISMATCH/);
  assert.match(sql, /MIXED_MOVEMENT_ORIGIN/);
  const opRefs = sql.match(/inventory_operation_id/g) ?? [];
  assert.ok(opRefs.length >= 10, `refs de operación insuficientes: ${opRefs.length}`);
});

test('033 conserva refs y semántica MAT', () => {
  assert.doesNotMatch(sql, /^CREATE OR REPLACE FUNCTION public\.material_request_/m);
  assert.doesNotMatch(sql, /^DROP FUNCTION public\.material_request_/m);
  assert.match(sql, /MATERIAL_REQUEST_LINE_REQUIRED/);
  assert.match(sql, /MATERIAL_REQUEST_LINE_MISMATCH/);
  assert.match(sql, /material_request_id, material_request_line_id,/);
});

test('033 usa tres claves de idempotencia independientes', () => {
  assert.match(sql, /ADD COLUMN create_idempotency_key uuid UNIQUE/);
  assert.match(sql, /ADD COLUMN confirm_idempotency_key uuid UNIQUE/);
  assert.match(sql, /ADD COLUMN cancel_idempotency_key uuid UNIQUE/);
  const create = bodyOf('inventory_operation_create');
  const confirm = bodyOf('inventory_operation_confirm');
  const cancel = bodyOf('inventory_operation_cancel');
  assert.match(create, /create_idempotency_key/);
  assert.doesNotMatch(create, /confirm_idempotency_key/);
  assert.doesNotMatch(create, /cancel_idempotency_key/);
  assert.match(confirm, /confirm_idempotency_key/);
  assert.doesNotMatch(confirm, /cancel_idempotency_key/);
  assert.match(cancel, /cancel_idempotency_key/);
  assert.doesNotMatch(cancel, /confirm_idempotency_key/);
  assert.match(confirm, /FOR UPDATE/);
  assert.match(cancel, /FOR UPDATE/);
  assert.match(confirm, /IDEMPOTENCY_CONFLICT/);
  assert.match(cancel, /IDEMPOTENCY_CONFLICT/);
});

test('033 protege inmutabilidad draft/confirmed/cancelled', () => {
  assert.match(sql, /inventory_operations_immutable_guard/);
  assert.match(sql, /inventory_operation_lines_immutable_guard/);
  const guards = sql.match(/IMMUTABLE_OPERATION/g) ?? [];
  assert.ok(guards.length >= 3, `guards insuficientes: ${guards.length}`);
  assert.match(sql, /OLD\.status IS DISTINCT FROM 'draft'/);
});

test('033 DROP sin CASCADE y con firmas exactas previas', () => {
  const drops = sql.match(/^DROP FUNCTION .*$/gm) ?? [];
  assert.deepEqual(drops.length, 4);
  for (const drop of drops) {
    assert.doesNotMatch(drop, /CASCADE/);
  }
  assert.ok(drops.some(line => line.includes('inventory_create_serialized_item(uuid, text, text, uuid)')));
  assert.ok(drops.some(line => line.includes('inventory_record_quantity_movement_legacy_026(uuid, text, numeric, text, uuid, uuid, text, uuid)')));
  assert.ok(drops.some(line => line.includes('inventory_dispatch_quantity(uuid, numeric, uuid, text, uuid, uuid, uuid)')));
  assert.ok(drops.some(line => line.includes('inventory_record_quantity_movement(uuid, text, numeric, text, uuid, uuid, text, uuid)')));
});

test('033 mantiene append-only de movements y seguridad', () => {
  assert.doesNotMatch(sql, /UPDATE public\.inventory_movements/);
  assert.doesNotMatch(sql, /DELETE FROM public\.inventory_movements/);
  assert.match(sql, /ALTER TABLE public\.inventory_operations ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.inventory_operation_lines ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = pg_catalog/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.inventory_operation_confirm/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.inventory_operation_cancel/);
  assert.match(sql, /TO service_role/);
});

test('033 prevalida ADJUST_OUT antes de mutar', () => {
  const confirm = bodyOf('inventory_operation_confirm');
  const failFast = confirm.indexOf('Fail-fast ADJUST_OUT');
  const mutation = confirm.indexOf('Mutación: una línea por producto');
  assert.notEqual(failFast, -1, 'falta bloque fail-fast ADJUST_OUT');
  assert.notEqual(mutation, -1, 'falta bloque de mutación');
  assert.ok(failFast < mutation, 'la prevaldación debe ocurrir antes de mutar');
});

test('033 valida seriales: trim/upper/tipo/no-vacíos/longitud/dedup', () => {
  const create = bodyOf('inventory_operation_create');
  assert.match(create, /pg_catalog\.upper\(pg_catalog\.btrim\(/);
  assert.match(create, /jsonb_typeof\(v_serial_element\) <> 'string'/);
  assert.match(create, /v_serial IS NULL OR v_serial = ''/);
  assert.match(create, /jsonb_array_length\(v_serials\) <> v_quantity::integer/);
  assert.match(create, /DUPLICATE_SERIAL_NUMBER/);
  assert.match(create, /SERIAL_ALREADY_EXISTS/);
});

// Regresión del 42601 del primer push: NULLIF exige exactamente 2
// argumentos. Un balanceador mínimo de paréntesis (las regex ingenuas
// terminan en el primer ")" interno de COALESCE/btrim anidados).
function nullifCalls(source) {
  const calls = [];
  const token = 'NULLIF(';
  let from = 0;
  while (true) {
    const start = source.indexOf(token, from);
    if (start === -1) break;
    let depth = 1;
    let topCommas = 0;
    let quote = null;
    let i = start + token.length;
    for (; i < source.length && depth > 0; i += 1) {
      const ch = source[i];
      if (quote !== null) {
        if (ch === quote && source[i + 1] !== quote) quote = null;
        else if (ch === quote) i += 1;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth -= 1;
      } else if (ch === ',' && depth === 1) {
        topCommas += 1;
      }
    }
    assert.equal(depth, 0, 'paréntesis NULLIF sin balancear');
    calls.push({ args: topCommas + 1, end: i });
    from = i;
  }
  return calls;
}

test('033 NULLIF siempre con exactamente 2 argumentos', () => {
  const calls = nullifCalls(sql);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.args, 2);
  }
});
