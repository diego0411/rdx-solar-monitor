import {
  normalizeGrowattPlant,
  normalizeGrowattPlantDetails,
} from '../providers/growatt/normalizeGrowattPlant.js';
import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import {
  getOrCreateGrowattAccount,
  updateGrowattPlantDetail,
  upsertGrowattPlant,
  listGrowattPlantsByUser,
  updateGrowattPlantMetadata,
} from '../repositories/plants.repository.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const provider = new GrowattProvider();
const PROGRESS_FILE = fileURLToPath(new URL('../../.cache/growatt-plant-sync.json', import.meta.url));
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let scheduledSync = null;
let syncRunning = false;

function scheduleNextSync(result) {
  if (scheduledSync || result.skipped) return;
  if (result.remaining_users === 0 && result.errors.length === 0 && result.processed_user == null) {
    writeProgress({});
  }
  const timer = setTimeout(() => {
    scheduledSync = null;
    syncGrowattPlants().catch(() => {});
  }, SYNC_INTERVAL_MS);
  timer.unref();
}

function readProgress() {
  if (!existsSync(PROGRESS_FILE)) return {};
  try {
    const value = JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeProgress(progress) {
  mkdirSync(new URL('../../.cache/', import.meta.url), { recursive: true });
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress), 'utf8');
}

function sanitizedMessage(error) {
  return error instanceof Error ? error.message : 'Error de consulta Growatt';
}

async function markGrowattUserSyncErrors(userName, message) {
  const plants = await listGrowattPlantsByUser(userName);
  const marker = `Growatt: ${userName}: ${message}`;
  for (const plant of plants) {
    const metadata = { ...(plant.metadata ?? {}) };
    if (metadata.growatt_sync_error === marker) continue;
    metadata.growatt_sync_error = marker;
    await updateGrowattPlantMetadata(plant.external_plant_id, metadata);
  }
}

async function clearGrowattUserSyncErrors(userName) {
  const plants = await listGrowattPlantsByUser(userName);
  for (const plant of plants) {
    if ((plant.metadata ?? {}).growatt_sync_error == null) continue;
    const { growatt_sync_error, ...metadata } = plant.metadata;
    await updateGrowattPlantMetadata(plant.external_plant_id, metadata);
  }
}

export async function syncGrowattPlants() {
  if (syncRunning) return { provider: 'growatt', skipped: true };
  syncRunning = true;
  const result = {
    provider: 'growatt', fetched_users: 0, processed_user: null, processed_users: 0,
    next_user: null, fetched_plants: 0, inserted: 0, updated: 0, remaining_users: 0,
    enriched: 0, enrich_failed: 0, failed: 0, errors: [],
  };
  try {
    const account = await getOrCreateGrowattAccount();
    const lastSyncedAt = new Date().toISOString();
    let users;
    try {
      users = await provider.listUsers();
      result.fetched_users = users.length;
    } catch (error) {
      result.failed += 1;
      result.errors.push(error instanceof Error ? error.message : 'Error de consulta Growatt');
      return result;
    }

    const progress = readProgress();
    const candidates = users.map(user => ({
      user,
      userName: user.c_user_name ?? user.user_name ?? user.username,
    })).filter(({ userName }) => userName && !progress[userName]);
    result.processed_users = users.length - candidates.length;
    result.remaining_users = candidates.length;
    result.next_user = candidates[0]?.userName ?? null;
    const selected = candidates[0];
    if (!selected) return result;

    result.processed_user = selected.userName;
    try {
      const plants = await provider.listUserPlants(selected.userName);
      result.fetched_plants = plants.length;
      for (const plant of plants) {
        try {
          const action = await upsertGrowattPlant(
            normalizeGrowattPlant(plant, selected.user), account.id, lastSyncedAt,
          );
          result[action] += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push(error instanceof Error ? error.message : 'Error de upsert Growatt');
          continue;
        }
        try {
          const externalPlantId = String(plant.plant_id ?? plant.external_plant_id ?? '');
          if (!externalPlantId) throw new Error('Planta Growatt sin plant_id');
          await updateGrowattPlantDetail(
            externalPlantId,
            normalizeGrowattPlantDetails(await provider.plantDetails(externalPlantId)),
          );
          result.enriched += 1;
        } catch {
          result.enrich_failed += 1;
        }
      }
      progress[selected.userName] = true;
      writeProgress(progress);
      result.processed_users += 1;
      result.remaining_users -= 1;
      result.next_user = candidates[1]?.userName ?? null;
      try {
        await clearGrowattUserSyncErrors(selected.userName);
        result.errors = result.errors.filter(
          error => !error.startsWith(`Growatt: ${selected.userName}:`),
        );
      } catch {
        // Best-effort: la limpieza del error se reintentará en la próxima pasada.
      }
    } catch (error) {
      result.failed += 1;
      const message = sanitizedMessage(error);
      result.errors.push(`Growatt: ${selected.userName}: ${message}`);
      try {
        await markGrowattUserSyncErrors(selected.userName, message);
      } catch {
        // Best-effort: el registro del error no detiene la sincronización.
      }
    }
    return result;
  } finally {
    syncRunning = false;
    scheduleNextSync(result);
  }
}
