import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiPlantDetail } from '../providers/hyxi/normalizeHyxiPlantDetail.js';
import { listActiveHyxiPlants, updatePlantDetail } from '../repositories/plants.repository.js';

const provider = new HyxiProvider();

export async function syncHyxiPlantDetails() {
  const plants = await listActiveHyxiPlants();
  const result = { provider: 'hyxi', fetched: plants.length, updated: 0, failed: 0 };

  for (const plant of plants) {
    try {
      const { data } = await provider.getPlant(plant.external_plant_id);
      await updatePlantDetail(plant.id, normalizeHyxiPlantDetail(data));
      result.updated += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
