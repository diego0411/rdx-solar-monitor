import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiPlant } from '../providers/hyxi/normalizeHyxiPlant.js';
import { getActiveHyxiAccount, upsertPlant } from '../repositories/plants.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiPlants() {
  const account = await getActiveHyxiAccount();
  const plants = [];
  const pageSize = 20;
  for (let currentPage = 1; ; currentPage += 1) {
    const page = await provider.listPlants({ currentPage, pageSize });
    plants.push(...page.plants);
    if (currentPage * pageSize >= page.total) break;
    if (!page.plants.length) throw new Error('HYXi devolvió una página vacía antes de completar la consulta');
  }

  const result = { provider: 'hyxi', fetched: plants.length, synced: 0, failed: 0 };
  const lastSyncedAt = new Date().toISOString();
  for (const plant of plants) {
    try {
      await upsertPlant(normalizeHyxiPlant(plant), account.id, lastSyncedAt);
      result.synced += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
