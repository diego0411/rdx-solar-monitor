import { listActiveHyxiPlants } from '../repositories/plants.repository.js';
import { localDateForTimezone, syncHyxiPowerHistoryWindow } from './hyxiPowerHistory.service.js';
import { syncHyxiEnergyHistory } from './hyxiEnergyHistory.service.js';

/*
 * Ciclo automático de históricos HYXi con resumen.
 *
 * Comportamiento intacto: secuencial por planta, los fallos de una
 * planta se registran y el ciclo continúa con la siguiente. Solo añade:
 * - retorno de resumen { plants, power_failures, energy_failures,
 *   failed_plants } (antes undefined),
 * - en los logs de fallo, mensaje + forma estructural segura
 *   (error.historyShape) en lugar del objeto de error completo.
 */

function errorMessage(error) {
  return error?.message ?? String(error);
}

function errorShape(error) {
  return error?.historyShape ?? null;
}

export async function syncHyxiHistoryCycle({
  listPlants = listActiveHyxiPlants,
  syncPowerWindow = syncHyxiPowerHistoryWindow,
  syncEnergy = syncHyxiEnergyHistory,
  now = () => new Date(),
  logger = console,
} = {}) {
  const plants = await listPlants();
  const summary = {
    plants: plants.length,
    power_failures: 0,
    energy_failures: 0,
    failed_plants: [],
  };
  const markFailed = plant => {
    if (!summary.failed_plants.includes(plant.external_plant_id)) {
      summary.failed_plants.push(plant.external_plant_id);
    }
  };
  for (const plant of plants) {
    const powerResult = await syncPowerWindow(plant);
    for (const failure of powerResult.errors) {
      summary.power_failures += 1;
      markFailed(plant);
      logger.error(`HYXi automatic power-history ${failure.period} failed for ${plant.external_plant_id}:`, {
        date: failure.date,
        message: errorMessage(failure.error),
        shape: errorShape(failure.error),
      });
    }
    for (const result of [powerResult.current, powerResult.closure]) {
      if (result?.failed > 0) {
        summary.power_failures += 1;
        markFailed(plant);
        logger.error('HYXi automatic power-history sync failed:', result);
      }
    }

    try {
      const startTime = localDateForTimezone(now(), plant.timezone);
      const result = await syncEnergy(plant.external_plant_id, 1, startTime);
      if (result.failed > 0) {
        summary.energy_failures += 1;
        markFailed(plant);
        logger.error('HYXi automatic energy-history sync failed:', result);
      }
    } catch (error) {
      summary.energy_failures += 1;
      markFailed(plant);
      logger.error(`HYXi automatic energy-history sync failed for ${plant.external_plant_id}:`, {
        message: errorMessage(error),
        shape: errorShape(error),
      });
    }
  }
  return summary;
}
