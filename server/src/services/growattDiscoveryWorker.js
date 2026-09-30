import { listActiveGrowattPlants } from '../repositories/plants.repository.js';
import { discoverGrowattPlant } from './growattDiscovery.service.js';

export const DISCOVERY_WINDOW_MS = 30 * 60 * 1000;
const MIN_INTERVAL_MS = 5000;
export function discoveryInterval(count) {
  return Math.max(MIN_INTERVAL_MS, Math.ceil(DISCOVERY_WINDOW_MS / Math.max(1, count)));
}

export function createGrowattDiscoveryWorker({
  listPlants = listActiveGrowattPlants, discover = discoverGrowattPlant,
  schedule = setTimeout, cancel = clearTimeout, logger = console,
} = {}) {
  let queue = [];
  let pendingId = null;
  let running = false;
  let started = false;
  let timer = null;
  let loopActive = false;
  let delay = DISCOVERY_WINDOW_MS;

  async function tick() {
    if (running) return { skipped: true };
    running = true;
    try {
      const plants = await listPlants();
      const active = new Map(plants.map(plant => [plant.id, plant]));
      // Keep surviving plants in circular order, appending newly active UUIDs.
      queue = queue.filter(id => active.has(id));
      for (const id of active.keys()) if (!queue.includes(id)) queue.push(id);
      delay = discoveryInterval(queue.length);
      if (!queue.length) { pendingId = null; return { plants: 0 }; }
      if (!queue.includes(pendingId)) pendingId = queue[0];
      const id = pendingId;
      let result;
      try {
        result = await discover(active.get(id));
      } catch (error) {
        result = { failed: 1, rate_limited: error?.rateLimited === true };
        logger.error('Growatt discovery plant failed', { plant_id: id, rate_limited: result.rate_limited });
      }
      // Always rotate the processed plant to the tail so a rate-limited
      // or skipped plant is retried on the next full lap instead of pinning the queue.
      queue = [...queue.filter(value => value !== id), id];
      pendingId = queue[0];
      return result;
    } catch {
      logger.error('Growatt discovery queue refresh failed');
      return { failed: 1 };
    } finally {
      running = false;
    }
  }

  async function loop() {
    loopActive = true;
    timer = null;
    try { await tick(); }
    finally {
      loopActive = false;
      if (started) {
        timer = schedule(loop, delay);
        timer?.unref?.();
      }
    }
  }

  return {
    tick,
    start() {
      if (started) return;
      started = true;
      // One initial plant, then one timer after each completed iteration.
      if (!loopActive) void loop();
    },
    stop() {
      started = false;
      if (timer !== null) cancel(timer);
      timer = null;
    },
  };
}

const worker = createGrowattDiscoveryWorker();
export function startGrowattDiscoveryWorker() { worker.start(); }
