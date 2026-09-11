import { normalizeGrowattPlant } from '../providers/growatt/normalizeGrowattPlant.js';
import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { getOrCreateGrowattAccount, upsertGrowattPlant } from '../repositories/plants.repository.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const provider = new GrowattProvider();
const PROGRESS_FILE = fileURLToPath(new URL('../../.cache/growatt-plant-sync.json', import.meta.url));
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let scheduledSync = null;

function scheduleNextSync(result) {
  if (scheduledSync || result.remaining_users === 0 || result.errors.length > 0) return;
  scheduledSync = setTimeout(() => {
    scheduledSync = null;
    syncGrowattPlants().catch(() => {});
  }, SYNC_INTERVAL_MS);
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

export async function syncGrowattPlants() {
  const account = await getOrCreateGrowattAccount();
  const result = {
    provider: 'growatt', fetched_users: 0, processed_user: null, processed_users: 0,
    next_user: null, fetched_plants: 0, inserted: 0, updated: 0, remaining_users: 0,
    failed: 0, errors: [],
  };
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
      }
    }
    progress[selected.userName] = true;
    writeProgress(progress);
    result.processed_users += 1;
    result.remaining_users -= 1;
    result.next_user = candidates[1]?.userName ?? null;
  } catch (error) {
    result.failed += 1;
    result.errors.push(error instanceof Error ? error.message : 'Error de consulta Growatt');
  }
  scheduleNextSync(result);
  return result;
}
