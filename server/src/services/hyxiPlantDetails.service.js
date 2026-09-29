import { HyxiProvider } from '../providers/hyxi/HyxiProvider.js';
import { normalizeHyxiPlantDetail } from '../providers/hyxi/normalizeHyxiPlantDetail.js';
import { listActiveHyxiPlants, updatePlantDetail } from '../repositories/plants.repository.js';

const provider = new HyxiProvider();

/*
 * Observabilidad: una línea por planta fallida + una de resumen del lote.
 * Solo identificadores y campos seguros del error (status HTTP, provider
 * code/message). Nunca tokens, headers, credenciales ni stacks. Nunca
 * lanza, aunque el error tenga estructura inesperada. La respuesta
 * pública { provider, fetched, updated, failed } no cambia.
 */
function sanitizePlantDetailError(error) {
  try {
    if (!error || typeof error !== 'object') {
      return { message: 'HYXi plant detail sync failed' };
    }
    const safe = {};
    if (error.message != null) safe.message = String(error.message).slice(0, 300);
    for (const [from, to] of [
      ['httpStatus', 'http_status'], ['http_status', 'http_status'],
      ['providerCode', 'provider_code'], ['provider_code', 'provider_code'],
      ['providerMsg', 'provider_message'], ['provider_message', 'provider_message'],
      ['statusCode', 'statusCode'],
    ]) {
      if (error[from] != null && typeof error[from] !== 'object') safe[to] = error[from];
    }
    return Object.keys(safe).length ? safe : { message: 'HYXi plant detail sync failed' };
  } catch {
    return { message: 'HYXi plant detail sync failed' };
  }
}

export async function syncHyxiPlantDetails() {
  const plants = await listActiveHyxiPlants();
  const result = { provider: 'hyxi', fetched: plants.length, updated: 0, failed: 0 };

  for (const plant of plants) {
    try {
      const { data } = await provider.getPlant(plant.external_plant_id);
      await updatePlantDetail(plant.id, normalizeHyxiPlantDetail(data));
      result.updated += 1;
    } catch (error) {
      result.failed += 1;
      console.error('HYXi plant details sync failed', {
        plant_id: plant?.id ?? null,
        external_plant_id: plant?.external_plant_id ?? null,
        ...sanitizePlantDetailError(error),
      });
    }
  }
  console.info('HYXi plant details sync pass', {
    fetched: result.fetched,
    updated: result.updated,
    failed: result.failed,
  });
  return result;
}
