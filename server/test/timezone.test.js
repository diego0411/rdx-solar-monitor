import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey } from '../src/utils/timezone.js';

test('GMT-4 resta 4 horas (muro = UTC - 4)', () => {
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', 'GMT-4'), '2026-09-21');
  assert.equal(localDateKey('2026-09-21T21:00:00.000Z', 'GMT-4'), '2026-09-21');
  assert.equal(localDateKey('2026-09-22T04:00:00.000Z', 'GMT-4'), '2026-09-22');
});

test('GMT+4 suma 4 horas (muro = UTC + 4)', () => {
  assert.equal(localDateKey('2026-09-21T21:00:00.000Z', 'GMT+4'), '2026-09-22');
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', 'GMT+4'), '2026-09-22');
  assert.equal(localDateKey('2026-09-21T19:00:00.000Z', 'GMT+4'), '2026-09-21');
});

test('acepta GMT con minutos y cero inicial', () => {
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', 'GMT-04:00'), '2026-09-21');
  assert.equal(localDateKey('2026-09-21T21:00:00.000Z', 'GMT+04:00'), '2026-09-22');
  assert.equal(localDateKey('2026-09-22T00:30:00.000Z', 'GMT+05:30'), '2026-09-22');
  assert.equal(localDateKey('2026-09-21T18:00:00.000Z', 'GMT+05:30'), '2026-09-21');
});

test('IANA y UTC sin cambios', () => {
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', 'America/La_Paz'), '2026-09-21');
  assert.equal(localDateKey('2026-09-22T04:00:00.000Z', 'America/La_Paz'), '2026-09-22');
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', 'UTC'), '2026-09-22');
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', null), '2026-09-22');
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', undefined), '2026-09-22');
});

test('Etc/GMT válido no lanza y respeta POSIX', () => {
  // Etc/GMT+4 = UTC-4 por POSIX.
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', 'Etc/GMT+4'), '2026-09-21');
});

test('zona inválida cae a UTC sin lanzar', () => {
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', 'No/Existe'), '2026-09-22');
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', 'GMT-99'), '2026-09-22');
  assert.equal(localDateKey('2026-09-22T02:00:00.000Z', ''), '2026-09-22');
});

test('acepta Date e instante inválido devuelve null', () => {
  assert.equal(localDateKey(new Date('2026-09-22T02:00:00.000Z'), 'GMT-4'), '2026-09-21');
  assert.equal(localDateKey('no-fecha', 'GMT-4'), null);
});
