import app from './app.js';
import { env } from './config/env.js';
import { syncGrowattPlants } from './services/growattPlants.service.js';
import { startGrowattDiscoveryWorker } from './services/growattDiscoveryWorker.js';
import { syncGrowattLatest } from './services/growattLatest.service.js';
import { syncGrowattPowerHistory } from './services/growattPowerHistory.service.js';
import { syncGrowattEnergyHistory, syncGrowattEnergyRollups } from './services/growattEnergyHistory.service.js';
import { syncHyxiPlants } from './services/hyxiPlants.service.js';
import { syncHyxiDevices } from './services/hyxiDevices.service.js';
import { syncHyxiRealtime } from './services/hyxiRealtime.service.js';
import { syncHyxiEnergySummary } from './services/hyxiEnergySummary.service.js';
import { createHyxiAlarmSync } from './services/hyxiAlarmSync.service.js';
import { createScheduledSync } from './services/scheduledSync.js';
import { syncHyxiHistoryCycle } from './services/hyxiHistoryCycle.service.js';
import { syncHyxiEnergyHistory } from './services/hyxiEnergyHistory.service.js';
import { startAutomaticSchedulers } from './services/schedulerControl.js';
import { listActiveGrowattPlants, listActiveHyxiPlants } from './repositories/plants.repository.js';

const HYXI_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const HYXI_TASK_TIMEOUT_MS = 60 * 1000;
const HYXI_HISTORY_TASK_TIMEOUT_MS = 9 * 60 * 1000;
const HYXI_HISTORY_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const GROWATT_LATEST_INTERVAL_MS = 5 * 60 * 1000;
const GROWATT_HISTORY_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const HISTORY_ROLLUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const runGrowattLatestSync = createScheduledSync({
  // Sin timeout: equivalente al lock 'skip' anterior. El wrapper aporta
  // inicio/fin con duration_ms, skip y el result (failed/rate_limited/...).
  name: 'latest', label: 'Growatt', sync: syncGrowattLatest,
});

async function syncGrowattHistoryCycle() {
  const plants = await listActiveGrowattPlants();
  const date = currentBoliviaDate();
  let failedPlants = 0;
  let frequentAccess = 0;
  for (const plant of plants) {
    try {
      await syncGrowattPowerHistory(plant, date);
      await syncGrowattEnergyHistory(plant, date);
    } catch (error) {
      failedPlants += 1;
      if (error?.frequentAccess) {
        frequentAccess += 1;
        console.error(`Growatt automatic history sync FREQUENTLY_ACCESS for ${plant.external_plant_id}`);
      } else {
        console.error(`Growatt automatic history sync failed for ${plant.external_plant_id}:`, error);
      }
    }
  }
  return { plants: plants.length, failed_plants: failedPlants, frequent_access: frequentAccess };
}

const runGrowattHistorySync = createScheduledSync({
  name: 'history', label: 'Growatt', sync: syncGrowattHistoryCycle,
});

const runHyxiPlantsSync = createScheduledSync({
  name: 'plants', sync: syncHyxiPlants, timeoutMs: HYXI_TASK_TIMEOUT_MS,
});
const runHyxiDevicesSync = createScheduledSync({
  name: 'devices', sync: syncHyxiDevices, timeoutMs: HYXI_TASK_TIMEOUT_MS,
});
const runHyxiRealtimeSync = createScheduledSync({
  name: 'realtime', sync: syncHyxiRealtime, timeoutMs: HYXI_TASK_TIMEOUT_MS,
});
const runHyxiEnergySummarySync = createScheduledSync({
  name: 'energy-summary', sync: syncHyxiEnergySummary, timeoutMs: HYXI_TASK_TIMEOUT_MS,
});
const runHyxiAlarmsSync = createScheduledSync({
  name: 'alarms', sync: createHyxiAlarmSync(), timeoutMs: HYXI_TASK_TIMEOUT_MS,
});

function currentBoliviaDate() {
  return new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const runHyxiHistorySync = createScheduledSync({
  name: 'history', sync: syncHyxiHistoryCycle, timeoutMs: HYXI_HISTORY_TASK_TIMEOUT_MS,
});

async function syncHistoricalRollups() {
  const startTime = currentBoliviaDate();
  const hyxiPlants = await listActiveHyxiPlants();
  for (const plant of hyxiPlants) {
    for (const timeType of [2, 3]) {
      try {
        await syncHyxiEnergyHistory(plant.external_plant_id, timeType, startTime);
      } catch (error) {
        console.error(`HYXi automatic energy rollup ${timeType} failed for ${plant.external_plant_id}:`, error);
      }
    }
  }
  const growattPlants = await listActiveGrowattPlants();
  for (const plant of growattPlants) {
    try {
      await syncGrowattEnergyRollups(plant, 'month', startTime);
      await syncGrowattEnergyRollups(plant, 'year', startTime);
    } catch (error) {
      console.error(`Growatt automatic energy rollup failed for ${plant.external_plant_id}:`, error);
    }
  }
  return { hyxi_plants: hyxiPlants.length, growatt_plants: growattPlants.length };
}

const runHistoricalRollupsSync = createScheduledSync({
  // Sin timeout de fallo: los rollups legítimamente superan 60 s. El umbral
  // solo advierte una vez; el control se libera al fin real, sin solapes.
  name: 'history-rollups', sync: syncHistoricalRollups, warnAfterMs: HYXI_TASK_TIMEOUT_MS,
});

app.listen(env.PORT, () => {
  console.log(`RDX Solar Monitor API listening on port ${env.PORT}`);
  startAutomaticSchedulers(env.ENABLE_SCHEDULERS, () => {
    syncGrowattPlants().catch(() => {});
    startGrowattDiscoveryWorker();
    runGrowattLatestSync();
    setInterval(runGrowattLatestSync, GROWATT_LATEST_INTERVAL_MS);
    runGrowattHistorySync();
    setInterval(runGrowattHistorySync, GROWATT_HISTORY_SYNC_INTERVAL_MS);
    for (const runSync of [
      runHyxiPlantsSync,
      runHyxiDevicesSync,
      runHyxiRealtimeSync,
      runHyxiEnergySummarySync,
      runHyxiAlarmsSync,
    ]) {
      void runSync();
      setInterval(runSync, HYXI_SYNC_INTERVAL_MS);
    }
    runHyxiHistorySync();
    setInterval(runHyxiHistorySync, HYXI_HISTORY_SYNC_INTERVAL_MS);
    void runHistoricalRollupsSync();
    setInterval(runHistoricalRollupsSync, HISTORY_ROLLUP_INTERVAL_MS);
  });
});
