import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChartTimeZone } from '../src/utils/chartTimezone.js';

const hour = iso => new Intl.DateTimeFormat('es-BO', {
  timeZone: resolveChartTimeZone('GMT-4'), hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));

test('2026-09-29T15:22:49Z + GMT-4 se muestra como 11:22', () => {
  assert.equal(hour('2026-09-29T15:22:49Z'), '11:22');
});

test('2026-09-29T14:42:45Z + GMT-4 se muestra como 10:42', () => {
  assert.equal(hour('2026-09-29T14:42:45Z'), '10:42');
});

test('GMT-4 nunca produce RangeError, incluida la rama month', () => {
  assert.equal(resolveChartTimeZone('GMT-4'), 'America/La_Paz');
  assert.doesNotThrow(() => new Intl.DateTimeFormat('es-BO', {
    timeZone: resolveChartTimeZone('GMT-4'), hour: '2-digit', minute: '2-digit',
  }));
  assert.doesNotThrow(() => new Intl.DateTimeFormat('es-BO', {
    day: '2-digit', month: 'short', timeZone: resolveChartTimeZone('GMT-4'),
  }).format(new Date('2026-09-29T15:22:49Z')));
});

test('un timezone IANA válido se conserva', () => {
  assert.equal(resolveChartTimeZone('America/La_Paz'), 'America/La_Paz');
  assert.equal(resolveChartTimeZone('UTC'), 'UTC');
});

test('timezone desconocido o ausente cae al fallback determinista del proyecto', () => {
  for (const value of ['No/Existe', '', null, undefined, 'GMT+5:30']) {
    assert.equal(resolveChartTimeZone(value), 'America/La_Paz');
  }
});

test('el timestamp original no se muta al formatear', () => {
  const iso = '2026-09-29T15:22:49Z';
  hour(iso);
  new Intl.DateTimeFormat('es-BO', {
    day: '2-digit', month: 'short', timeZone: resolveChartTimeZone('GMT-4'),
  }).format(new Date(iso));
  assert.equal(iso, '2026-09-29T15:22:49Z');
});
