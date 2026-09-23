function summarizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) =>
      value === null || ['string', 'number', 'boolean'].includes(typeof value)),
  );
}

function withTimeout(promise, timeoutMs, taskName) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${taskName} sync timed out after ${timeoutMs} ms`);
      error.code = 'SYNC_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function createScheduledSync({ name, sync, timeoutMs, logger = console }) {
  let running = false;

  return async function runScheduledSync() {
    if (running) {
      logger.warn(`HYXi automatic ${name} sync skipped: previous execution is still running`);
      return { skipped: true };
    }

    running = true;
    const startedAt = Date.now();
    logger.info(`HYXi automatic ${name} sync started`);

    try {
      const result = await withTimeout(Promise.resolve().then(sync), timeoutMs, name);
      logger.info(`HYXi automatic ${name} sync finished`, {
        duration_ms: Date.now() - startedAt,
        result: summarizeResult(result),
      });
      return result;
    } catch (error) {
      logger.error(`HYXi automatic ${name} sync failed`, {
        duration_ms: Date.now() - startedAt,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      });
      return { failed: true, error };
    } finally {
      running = false;
    }
  };
}
