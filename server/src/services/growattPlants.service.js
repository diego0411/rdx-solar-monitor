import { normalizeGrowattPlant } from '../providers/growatt/normalizeGrowattPlant.js';
import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { getOrCreateGrowattAccount, upsertGrowattPlant } from '../repositories/plants.repository.js';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const provider = new GrowattProvider();
const PROGRESS_FILE = fileURLToPath(new URL('../../.cache/growatt-plant-sync.json', import.meta.url));
const RECENT_WINDOW_MS = 5 * 60 * 1000;

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
    provider: 'growatt', fetched_users: 0, processed_user: null, fetched_plants: 0,
    inserted: 0, updated: 0, remaining_users: 0, failed: 0, errors: [],
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
  const now = Date.now();
  const candidates = users.map(user => ({
    user,
    userName: user.c_user_name ?? user.user_name ?? user.username,
  })).filter(({ userName }) => userName && (!progress[userName]
    || now - Number(progress[userName]) >= RECENT_WINDOW_MS));
  result.remaining_users = candidates.length;
  const selected = candidates.sort((a, b) => (Number(progress[a.userName] || 0) - Number(progress[b.userName] || 0)))[0];
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
    progress[selected.userName] = now;
    writeProgress(progress);
    result.remaining_users = users.filter(user => {
      const name = user.c_user_name ?? user.user_name ?? user.username;
      return name && name !== selected.userName;
    }).length;
  } catch (error) {
    result.failed += 1;
    result.errors.push(error instanceof Error ? error.message : 'Error de consulta Growatt');
  }
  return result;
}