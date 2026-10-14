import assert from 'node:assert/strict';
import test from 'node:test';
import { withSyncLock } from '../src/services/syncLock.js';

test('join shares work; skip and independent keys retain their contracts', async () => {
  let release;
  const first = withSyncLock('one', () => new Promise(resolve => { release = resolve; }));
  assert.equal(withSyncLock('one', () => assert.fail('duplicate work')), first);
  assert.deepEqual(await withSyncLock('one', () => assert.fail(), { mode: 'skip' }), { skipped: true });
  assert.equal(await withSyncLock('two', () => 2), 2);
  release(1);
  assert.equal(await first, 1);
  assert.equal(await withSyncLock('one', () => 3), 3);
});

test('queued operations keep their inputs and wait through failure and the entire queue', async () => {
  let reject;
  let releaseSecond;
  const events = [];
  const first = withSyncLock('queue', () => new Promise((_, fail) => { reject = fail; }));
  const failure = assert.rejects(first, /failed/);
  const second = withSyncLock('queue', () => {
    events.push(2);
    return new Promise(resolve => { releaseSecond = resolve; });
  }, { mode: 'queue' });
  const third = withSyncLock('queue', () => { events.push(3); return 3; }, { mode: 'queue' });
  await Promise.resolve();
  assert.deepEqual(events, []);
  reject(new Error('failed'));
  await failure;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [2]);
  assert.deepEqual(await withSyncLock('queue', () => assert.fail(), { mode: 'skip' }), { skipped: true });
  releaseSecond(2);
  assert.equal(await second, 2);
  assert.equal(await third, 3);
  assert.deepEqual(events, [2, 3]);
  await assert.rejects(withSyncLock('queue', () => { throw new Error('sync throw'); }), /sync throw/);
  assert.equal(await withSyncLock('queue', () => 4), 4);
});
