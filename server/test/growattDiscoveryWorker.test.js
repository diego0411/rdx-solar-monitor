import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../src/repositories/plants.repository.js', { exports: { listActiveGrowattPlants() { throw new Error('Unexpected real read'); } } });
mock.module('../src/services/growattDiscovery.service.js', { exports: { discoverGrowattPlant() { throw new Error('Unexpected real discovery'); } } });
const { createGrowattDiscoveryWorker, discoveryInterval } = await import('../src/services/growattDiscoveryWorker.js');
const logger = { error() {} };
const plant = id => ({ id, external_plant_id: id });

test('one plant per tick, circular order, rate limit and failure rotate without starvation', async () => {
  const calls = []; let limit = false; let fail = false;
  const worker = createGrowattDiscoveryWorker({ logger,
    listPlants: async () => ['a', 'b', 'c'].map(plant),
    discover: async p => {
      calls.push(p.id);
      if (fail) throw new Error('normal');
      return { rate_limited: limit };
    },
  });
  await worker.tick(); assert.deepEqual(calls, ['a']);
  limit = true; await worker.tick(); await worker.tick();
  assert.deepEqual(calls, ['a', 'b', 'c']);
  limit = false; await worker.tick();
  fail = true; await worker.tick();
  fail = false; await worker.tick();
  assert.deepEqual(calls, ['a', 'b', 'c', 'a', 'b', 'c']);
});

test('persistent rate limit on one plant never starves the rest', async () => {
  const calls = [];
  const worker = createGrowattDiscoveryWorker({ logger,
    listPlants: async () => ['a', 'b', 'c', 'd'].map(plant),
    discover: async p => { calls.push(p.id); return { rate_limited: p.id === 'b' }; },
  });
  for (let index = 0; index < 8; index++) await worker.tick();
  assert.deepEqual(calls, ['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd']);
});

test('skipped result advances the queue instead of pinning pending', async () => {
  const calls = [];
  const worker = createGrowattDiscoveryWorker({ logger,
    listPlants: async () => ['a', 'b'].map(plant),
    discover: async p => { calls.push(p.id); return p.id === 'a' ? { skipped: true } : {}; },
  });
  await worker.tick(); await worker.tick(); await worker.tick();
  assert.deepEqual(calls, ['a', 'b', 'a']);
});

test('refresh supports additions, removals, empty list and changed repository ordering', async () => {
  let active = ['a', 'b']; const calls = [];
  const worker = createGrowattDiscoveryWorker({ logger,
    listPlants: async () => active.map(plant), discover: async p => { calls.push(p.id); return {}; },
  });
  await worker.tick();
  active = ['c', 'b', 'a']; await worker.tick(); await worker.tick(); await worker.tick();
  assert.deepEqual(calls, ['a', 'b', 'a', 'c']);
  active = ['c']; await worker.tick(); assert.equal(calls.at(-1), 'c');
  active = []; await worker.tick(); assert.equal(calls.length, 5);
  active = ['new']; await worker.tick(); assert.equal(calls.at(-1), 'new');
});

test('interval follows window/count with minimum and safe empty-list delay', () => {
  for (const [count, delay] of [[1, 1800000], [8, 225000], [20, 90000], [100, 18000], [0, 1800000], [10000, 5000]]) {
    assert.equal(discoveryInterval(count), delay);
  }
});

test('one timer after completion, idempotent start, no overlap, stop/restart during execution', async () => {
  let release; let calls = 0; const timers = new Map(); let index = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const worker = createGrowattDiscoveryWorker({ logger,
    listPlants: async () => ['a', 'b'].map(plant),
    discover: async () => { calls++; await blocked; return {}; },
    schedule: (fn, delay) => { timers.set(++index, { fn, delay }); return index; },
    cancel: id => timers.delete(id),
  });
  assert.equal(timers.size, 0);
  worker.start(); worker.start();
  await Promise.resolve();
  assert.equal(calls, 1); assert.equal(timers.size, 0);
  assert.deepEqual(await worker.tick(), { skipped: true });
  worker.stop(); worker.start();
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 900000);
  const [id, timer] = [...timers][0]; timers.delete(id); await timer.fn();
  assert.equal(calls, 2); assert.equal(timers.size, 1);
  worker.stop(); assert.equal(timers.size, 0);
});

test('empty list and repository failures rearm only one delayed timer without discovery', async () => {
  let fail = false; const timers = [];
  const worker = createGrowattDiscoveryWorker({ logger,
    listPlants: async () => { if (fail) throw new Error('private'); return []; },
    discover: async () => assert.fail('no plants'),
    schedule: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, cancel() {},
  });
  worker.start(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 1); assert.equal(timers[0].delay, 1800000);
  fail = true; await timers[0].fn();
  assert.equal(timers.length, 2); assert.equal(timers[1].delay, 1800000);
  worker.stop();
});
