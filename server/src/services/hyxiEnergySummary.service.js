import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiEnergySummary } from '../providers/hyxi/normalizeHyxiEnergySummary.js';
import { listActiveHyxiPlants } from '../repositories/plants.repository.js';
import { upsertPlantEnergySummary } from '../repositories/plantEnergySummary.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiEnergySummary() {
  const plants = await listActiveHyxiPlants();
  const result = { provider: 'hyxi', fetched: plants.length, updated: 0, failed: 0 };
  for (const plant of plants) {
    try {
      const response = await provider.getPlantEnergySummary(plant.external_plant_id);
      await upsertPlantEnergySummary(normalizeHyxiEnergySummary(response, plant.id));
      result.updated += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
