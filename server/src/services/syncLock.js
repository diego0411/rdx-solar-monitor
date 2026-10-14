// Process-local exclusion: deployments must run a single backend process.
// Join only equivalent operations; queue distinct operations sharing writes.
// Never release on an observation timeout: only the actual work owns the lock.
const pending = new Map();

export function withSyncLock(key, work, { mode = 'join' } = {}) {
  const previous = pending.get(key);
  if (previous && mode === 'join') return previous;
  if (previous && mode === 'skip') return Promise.resolve({ skipped: true });

  const ready = previous ? previous.catch(() => {}) : Promise.resolve();
  const execution = ready.then(work).finally(() => {
    if (pending.get(key) === execution) pending.delete(key);
  });
  pending.set(key, execution);
  return execution;
}
