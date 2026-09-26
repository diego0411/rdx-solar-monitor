import { listEnergyIntervalsRange } from '../repositories/energyIntervals.repository.js';
import { listPlantEnergyTariffsForRange } from '../repositories/plantEnergyTariffs.repository.js';
import { localDateKey } from '../utils/timezone.js';
import { periodRange } from './historyPeriods.js';

const energyFields = [
  'generation_kwh',
  'consumption_kwh',
  'grid_import_kwh',
  'grid_export_kwh',
];

function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strictSum(values) {
  return values.length && values.every(value => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function applicableTariff(tariffs, date) {
  return tariffs.find(tariff => tariff.effective_from <= date
    && (tariff.effective_to === null || tariff.effective_to >= date)) ?? null;
}

function commonValue(values) {
  const unique = [...new Set(values.filter(value => value !== null && value !== undefined))];
  if (!unique.length) return null;
  return unique.length === 1 ? unique[0] : 'mixed';
}

export function calculatePlantEconomics(rows, tariffs, { period, start, end }) {
  const intervalResults = rows.map(row => {
    const values = Object.fromEntries(energyFields.map(field => [field, numeric(row[field])]));
    const localDate = localDateKey(row.interval_start, row.timezone);
    const tariff = localDate ? applicableTariff(tariffs, localDate) : null;
    const purchaseRate = numeric(tariff?.purchase_energy_rate);
    const exportRate = numeric(tariff?.export_energy_rate);
    const compensation = tariff?.export_compensation_type ?? null;

    // Initial economic model: onsite use = PV generation - grid export.
    // With storage this is an estimate; battery flows remain available in energy_intervals.
    // Negative raw values are inconsistent measurements: self-consumption clamps to 0
    // while the interval keeps its inconsistent flag for coverage reporting.
    const rawSelfConsumption = values.generation_kwh !== null && values.grid_export_kwh !== null
      ? values.generation_kwh - values.grid_export_kwh
      : null;
    const inconsistent = rawSelfConsumption !== null && rawSelfConsumption < 0;
    const selfConsumption = rawSelfConsumption === null ? null : Math.max(rawSelfConsumption, 0);
    const productionValue = values.generation_kwh !== null && purchaseRate !== null
      ? values.generation_kwh * purchaseRate : null;
    const selfConsumptionSavings = selfConsumption !== null && purchaseRate !== null
      ? selfConsumption * purchaseRate : null;

    let exportValue = null;
    let exportCredit = null;
    if (compensation === 'none') exportValue = 0;
    if (compensation === 'monetary' && values.grid_export_kwh !== null && exportRate !== null) {
      exportValue = values.grid_export_kwh * exportRate;
    }
    if (compensation === 'energy_credit') {
      exportCredit = values.grid_export_kwh;
      if (values.grid_export_kwh !== null && exportRate !== null) {
        exportValue = values.grid_export_kwh * exportRate;
      }
    }
    // Semantic aliases for the V1 contract: export_value is kept untouched
    // for backwards compatibility.
    const exportCompensationValue = exportValue;
    const exportCreditEstimatedValue = compensation === 'energy_credit' ? exportValue : null;

    return {
      ...values,
      self_consumption_kwh: selfConsumption,
      production_value: productionValue,
      self_consumption_savings: selfConsumptionSavings,
      export_value: exportValue,
      export_compensation_value: exportCompensationValue,
      export_credit_estimated_value: exportCreditEstimatedValue,
      export_credit_kwh: exportCredit,
      tariff,
      inconsistent,
      source_partial: row.raw_data?.coverage === 'partial',
    };
  });

  const total = field => strictSum(intervalResults.map(row => row[field]));
  const missingEnergyIntervals = intervalResults.filter(row => energyFields
    .some(field => row[field] === null)).length;
  const missingTariffIntervals = intervalResults.filter(row => row.tariff === null).length;
  const inconsistentIntervals = intervalResults.filter(row => row.inconsistent).length;
  const sourcePartialIntervals = intervalResults.filter(row => row.source_partial).length;
  const currency = commonValue(intervalResults.map(row => row.tariff?.currency ?? null));
  const mixedCurrency = currency === 'mixed';
  const singleOrNull = value => (value === 'mixed' ? null : value);
  const productionValue = mixedCurrency ? null : total('production_value');
  const selfConsumptionSavings = mixedCurrency ? null : total('self_consumption_savings');
  const exportValue = mixedCurrency ? null : total('export_value');
  const exportCompensationValue = mixedCurrency ? null : total('export_compensation_value');
  const creditIntervals = intervalResults.filter(row =>
    row.tariff?.export_compensation_type === 'energy_credit');
  const exportCredit = creditIntervals.length
    ? strictSum(creditIntervals.map(row => row.export_credit_kwh)) : null;
  const exportCreditEstimatedValue = mixedCurrency || !creditIntervals.length
    ? null : strictSum(creditIntervals.map(row => row.export_credit_estimated_value));
  const estimatedBenefit = selfConsumptionSavings !== null && exportValue !== null
    ? selfConsumptionSavings + exportValue : null;
  const status = !rows.length ? 'none'
    : missingEnergyIntervals || missingTariffIntervals || inconsistentIntervals
        || sourcePartialIntervals || mixedCurrency
      ? 'partial' : 'available';

  return {
    period,
    start,
    end,
    generation_kwh: total('generation_kwh'),
    consumption_kwh: total('consumption_kwh'),
    self_consumption_kwh: total('self_consumption_kwh'),
    grid_import_kwh: total('grid_import_kwh'),
    grid_export_kwh: total('grid_export_kwh'),
    production_value: productionValue,
    self_consumption_savings: selfConsumptionSavings,
    export_value: exportValue,
    export_compensation_value: exportCompensationValue,
    export_credit_estimated_value: exportCreditEstimatedValue,
    export_credit_kwh: exportCredit,
    estimated_economic_benefit: estimatedBenefit,
    currency,
    purchase_energy_rate: singleOrNull(commonValue(intervalResults
      .map(row => numeric(row.tariff?.purchase_energy_rate)))),
    export_energy_rate: singleOrNull(commonValue(intervalResults
      .map(row => numeric(row.tariff?.export_energy_rate)))),
    compensation_type: commonValue(intervalResults
      .map(row => row.tariff?.export_compensation_type ?? null)),
    coverage: {
      status,
      complete: false,
      intervals: rows.length,
      missing_energy_intervals: missingEnergyIntervals,
      missing_tariff_intervals: missingTariffIntervals,
      inconsistent_intervals: inconsistentIntervals,
      source_partial_intervals: sourcePartialIntervals,
      mixed_currency: mixedCurrency,
      note: rows.length
        ? 'La disponibilidad de intervalos no demuestra por sí sola cobertura total del periodo.'
        : 'No existen intervalos energéticos para el periodo.',
    },
  };
}

export async function getPlantEconomicSummary(plantId, period, selectedDate) {
  const range = periodRange(period, selectedDate);
  const [rows, tariffs] = await Promise.all([
    listEnergyIntervalsRange(plantId, 1, range.start, range.end),
    listPlantEnergyTariffsForRange(plantId, range.start, range.end),
  ]);
  return calculatePlantEconomics(rows, tariffs, { period, start: range.start, end: range.end });
}
