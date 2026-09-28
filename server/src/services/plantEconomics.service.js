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

// Suma observada aditiva: solo agrega valores utilizables ya normalizados.
// Dato faltante != 0: los NULL nunca se rellenan ni se estiman.
function observedMetric(values) {
  const present = values.filter(value => value !== null);
  const validIntervals = present.length;
  const totalIntervals = values.length;
  const complete = totalIntervals > 0 && validIntervals === totalIntervals;
  return {
    value: validIntervals ? present.reduce((sum, value) => sum + value, 0) : null,
    valid_intervals: validIntervals,
    total_intervals: totalIntervals,
    complete,
    quality: validIntervals === 0 ? 'UNAVAILABLE' : (complete ? 'EXACT' : 'PARTIAL'),
  };
}

function combineQuality(...qualities) {
  if (qualities.some(quality => quality === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (qualities.some(quality => quality === 'PARTIAL')) return 'PARTIAL';
  return 'EXACT';
}

export function calculatePlantEconomics(rows, tariffs, { period, start, end, now = Date.now() }) {
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
      local_date: localDate,
    };
  });

  // Período en curso: el rango contiene el día local actual (misma
  // semántica de calendario/timezone que el resto del servicio).
  // Sin muestras, sin estado del inversor, sin ocaso: solo calendario.
  const rowTimezone = rows.find(row => row.timezone)?.timezone ?? 'UTC';
  const todayLocal = localDateKey(new Date(now), rowTimezone) ?? '';
  const periodInProgress = todayLocal !== '' && start <= todayLocal && todayLocal < end;

  // Medición red/carga sospechosa: evaluación conservadora POR DÍA LOCAL
  // sobre histórico almacenado. Solo si generación completa y >0 con los
  // tres contadores de red/carga completos y exactamente en 0.
  // Nunca por métricas incompletas, generación 0 o estado del inversor.
  const byLocalDay = new Map();
  for (const row of intervalResults) {
    if (row.local_date === null) continue;
    if (!byLocalDay.has(row.local_date)) byLocalDay.set(row.local_date, []);
    byLocalDay.get(row.local_date).push(row);
  }
  const suspectDay = group => {
    if (!group.length) return false;
    const complete = field => group.every(row => row[field] !== null);
    const sum = field => group.reduce((total, row) => total + row[field], 0);
    return complete('generation_kwh') && sum('generation_kwh') > 0
      && complete('consumption_kwh') && sum('consumption_kwh') === 0
      && complete('grid_import_kwh') && sum('grid_import_kwh') === 0
      && complete('grid_export_kwh') && sum('grid_export_kwh') === 0;
  };
  const suspectDays = [...byLocalDay.keys()].filter(day => suspectDay(byLocalDay.get(day))).sort();
  const meterSuspect = suspectDays.length > 0;
  // Compensación 'none' en todo el período: export_value es 0 por regla,
  // independiente de la medición, y no se marca SUSPECT.
  const allNoneCompensation = intervalResults.length > 0
    && intervalResults.every(row => row.tariff?.export_compensation_type === 'none');

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
  // Métricas aditivas con cobertura por campo. No alteran escalares legacy:
  // cada derivada agrega solo intervalos donde sus insumos reales existen.
  // self_consumption_kwh por intervalo ya es null sin generation+export, y
  // savings/export_value por intervalo ya son null sin su tarifa aplicable.
  const energyMetrics = Object.fromEntries(energyFields.map(field => [field, observedMetric(
    intervalResults.map(row => row[field]))]));
  const selfConsumptionMetric = observedMetric(
    intervalResults.map(row => row.self_consumption_kwh));
  const savingsObserved = observedMetric(
    intervalResults.map(row => row.self_consumption_savings));
  const exportObserved = observedMetric(
    intervalResults.map(row => row.export_value));
  const benefitObserved = observedMetric(intervalResults.map(row => (
    row.self_consumption_savings !== null && row.export_value !== null
      ? row.self_consumption_savings + row.export_value : null)));
  // Moneda mixta: los datos existen pero no son agregables. Se conserva el
  // conteo real y se fuerza value=null + quality UNAVAILABLE en dinero.
  const moneyMetric = observed => (mixedCurrency
    ? { ...observed, value: null, quality: 'UNAVAILABLE' } : observed);
  const savingsMetric = moneyMetric(savingsObserved);
  const exportValueMetric = moneyMetric(exportObserved);
  const benefitMetric = mixedCurrency
    ? { ...benefitObserved, value: null, quality: 'UNAVAILABLE' }
    : {
      ...benefitObserved,
      quality: combineQuality(savingsObserved.quality, exportObserved.quality),
    };
  // Medición sospechosa: los ceros de red/carga no son confiables y ningún
  // derivado (autoconsumo, ahorro, exportación, beneficio) puede calcularse
  // con ellos. Generación intacta. Única excepción: moneda mixta ya deja el
  // dinero en UNAVAILABLE (no agregable) y se conserva.
  // Sin convertir ceros en NULL: energy_intervals no se toca.
  const suspectMetric = (observed, { nullable, monetary }) => {
    if (!meterSuspect || (mixedCurrency && monetary)) return observed;
    return { ...observed, value: nullable ? null : observed.value, quality: 'SUSPECT' };
  };
  const metrics = {
    ...energyMetrics,
    consumption_kwh: suspectMetric(energyMetrics.consumption_kwh, { nullable: false, monetary: false }),
    grid_import_kwh: suspectMetric(energyMetrics.grid_import_kwh, { nullable: false, monetary: false }),
    grid_export_kwh: suspectMetric(energyMetrics.grid_export_kwh, { nullable: false, monetary: false }),
    self_consumption_kwh: suspectMetric(selfConsumptionMetric, { nullable: true, monetary: false }),
    self_consumption_savings: suspectMetric(savingsMetric, { nullable: true, monetary: true }),
    export_value: allNoneCompensation ? exportValueMetric
      : suspectMetric(exportValueMetric, { nullable: true, monetary: true }),
    estimated_economic_benefit: suspectMetric(benefitMetric, { nullable: true, monetary: true }),
  };
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
      period_in_progress: periodInProgress,
      meter_suspect: meterSuspect,
      suspect_days: suspectDays,
      note: rows.length
        ? 'La disponibilidad de intervalos no demuestra por sí sola cobertura total del periodo.'
        : 'No existen intervalos energéticos para el periodo.',
    },
    metrics,
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
