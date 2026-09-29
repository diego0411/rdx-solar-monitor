import assert from 'node:assert/strict';
import test from 'node:test';

import {
  schedulersEnabled,
  startAutomaticSchedulers,
} from '../src/services/schedulerControl.js';

function startsFor(value) {
  let starts = 0;
  const enabled = schedulersEnabled(value);
  const started = startAutomaticSchedulers(enabled, () => { starts += 1; });
  return { enabled, started, starts };
}

test('ENABLE_SCHEDULERS=false no inicia jobs automáticos', () => {
  assert.deepEqual(startsFor('false'), { enabled: false, started: false, starts: 0 });
});

test('ENABLE_SCHEDULERS ausente no inicia jobs automáticos', () => {
  assert.deepEqual(startsFor(undefined), { enabled: false, started: false, starts: 0 });
});

test('ENABLE_SCHEDULERS=true inicia el bloque actual de schedulers', () => {
  assert.deepEqual(startsFor('true'), { enabled: true, started: true, starts: 1 });
});

test('ENABLE_SCHEDULERS usa semántica estricta', () => {
  for (const value of ['TRUE', ' true', '1', '', null]) {
    assert.equal(schedulersEnabled(value), false);
  }
});
