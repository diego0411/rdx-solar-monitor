import app from './app.js';
import { env } from './config/env.js';
import { syncGrowattPlants } from './services/growattPlants.service.js';
import { syncGrowattLatest } from './services/growattLatest.service.js';
import { syncGrowattPowerHistory } from './services/growattPowerHistory.service.js';
import { syncGrowattEnergyHistory } from './services/growattEnergyHistory.service.js';
import { syncHyxiPlants } from './services/hyxiPlants.service.js';
import { syncHyxiDevices } from './services/hyxiDevices.service.js';
import { syncHyxiRealtime } from './services/hyxiRealtime.service.js';
import { syncHyxiEnergySummary } from './services/hyxiEnergySummary.service.js';
import { syncHyxiPowerHistory } from './services/hyxiPowerHistory.service.js';
import { syncHyxiEnergyHistory } from './services/hyxiEnergyHistory.service.js';
import { listActiveGrowattPlants, listActiveHyxiPlants } from './repositories/plants.repository.js';

const HYXI_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const HYXI_HISTORY_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const GROWATT_LATEST_INTERVAL_MS = 5 * 60 * 1000;
const GROWATT_HISTORY_SYNC_INTERVAL_MS = 30 * 60 * 1000;
let hyxiSyncRunning = false;
let hyxiHistorySyncRunning = false;
let growattLatestSyncRunning = false;
let growattHistorySyncRunning = false;

async function runGrowattLatestSync() {
  if (growattLatestSyncRunning) return;
  growattLatestSyncRunning = true;
  try {
    const result = await syncGrowattLatest();
    if (result.failed > 0 || result.rate_limited || result.permission_denied) {
      console.error('Growatt automatic latest sync failed:', result);
    }
  } catch (error) {
    console.error('Growatt automatic latest sync failed:', error);
  } finally {
    growattLatestSyncRunning = false;
  }
}

async function runGrowattHistorySync() {
  if (growattHistorySyncRunning) return;
  growattHistorySyncRunning = true;
  try {
    const plants = await listActiveGrowattPlants();
    const date = currentBoliviaDate();
    for (const plant of plants) {
      try {
        await syncGrowattPowerHistory(plant, date);
        await syncGrowattEnergyHistory(plant, date);
      } catch (error) {
        if (error?.frequentAccess) {
          console.error(`Growatt automatic history sync FREQUENTLY_ACCESS for ${plant.external_plant_id}`);
        } else {
          console.error(`Growatt automatic history sync failed for ${plant.external_plant_id}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Growatt automatic history sync failed:', error);
  } finally {
    growattHistorySyncRunning = false;
  }
}

async function runHyxiSync() {
  if (hyxiSyncRunning) return;
  hyxiSyncRunning = true;
  try {
    for (const [name, sync] of [
      ['plants', syncHyxiPlants],
      ['devices', syncHyxiDevices],
      ['realtime', syncHyxiRealtime],
      ['energy-summary', syncHyxiEnergySummary],
    ]) {
      try {
        const result = await sync();
        if (result.failed > 0) console.error(`HYXi automatic ${name} sync failed:`, result);
      } catch (error) {
        console.error(`HYXi automatic ${name} sync failed:`, error);
      }
    }
  } finally {
    hyxiSyncRunning = false;
  }
}

function currentBoliviaDate() {
  return new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function runHyxiHistorySync() {
  if (hyxiHistorySyncRunning) return;
  hyxiHistorySyncRunning = true;
  try {
    const plants = await listActiveHyxiPlants();
    const startTime = currentBoliviaDate();
    for (const plant of plants) {
      for (const [name, sync] of [
        ['power-history', () => syncHyxiPowerHistory(plant.external_plant_id, startTime)],
        ['energy-history', () => syncHyxiEnergyHistory(plant.external_plant_id, 1, startTime)],
      ]) {
        try {
          const result = await sync();
          if (result.failed > 0) console.error(`HYXi automatic ${name} sync failed:`, result);
        } catch (error) {
          console.error(`HYXi automatic ${name} sync failed for ${plant.external_plant_id}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('HYXi automatic history sync failed:', error);
  } finally {
    hyxiHistorySyncRunning = false;
  }
}

app.listen(env.PORT, () => {
  console.log(`RDX Solar Monitor API listening on port ${env.PORT}`);
  syncGrowattPlants().catch(() => {});
  runGrowattLatestSync();
  setInterval(runGrowattLatestSync, GROWATT_LATEST_INTERVAL_MS);
  runGrowattHistorySync();
  setInterval(runGrowattHistorySync, GROWATT_HISTORY_SYNC_INTERVAL_MS);
  runHyxiSync();
  setInterval(runHyxiSync, HYXI_SYNC_INTERVAL_MS);
  runHyxiHistorySync();
  setInterval(runHyxiHistorySync, HYXI_HISTORY_SYNC_INTERVAL_MS);
});
