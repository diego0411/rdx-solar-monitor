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
  if (qualities.some(quality => quality === 'SUSPECT')) return 'SUSPECT';
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
  // sobre histórico almacenado. Requiere producción FV observada (>0) más
  // los tres canales de red/carga COMPLETOS y exactamente en 0.
  // Generación puede ser parcial (NULL aislados impiden el total EXACTO,
  // no convierten tres canales planos en medición confiable).
  // Nunca por canales incompletos, sin generación válida o generación 0.
  const byLocalDay = new Map();
  for (const row of intervalResults) {
    if (row.local_date === null) continue;
    if (!byLocalDay.has(row.local_date)) byLocalDay.set(row.local_date, []);
    byLocalDay.get(row.local_date).push(row);
  }
  const suspectDay = group => {
    if (!group.length) return false;
    const complete = field => group.every(row => row[field] !== null);
    const observedSum = field => group.reduce((total, row) => total + (row[field] ?? 0), 0);
    const sum = field => group.reduce((total, row) => total + row[field], 0);
    return group.some(row => row.generation_kwh !== null) && observedSum('generation_kwh') > 0
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
  // Autoconsumo agregado: con generation+export completos, los negativos por
  // intervalo son desfase de contadores (resolución 0.1 kWh en polls
  // distintos) que se cancela en el agregado. Clampar por intervalo fabrica
  // sesgo (Huang: +1.0 kWh). Solo el agregado decide coherencia.
  // Con cobertura PARCIAL vale la misma regla sobre el agregado OBSERVADO
  // (faltantes tratados como 0 solo para este test, nunca estimados como
  // energía): un agregado >= -tolerancia no es inconsistente aunque haya
  // pares negativos aislados por desfase/granularidad. Solo un agregado
  // materialmente negativo mantiene la inconsistencia.
  // FP_DUST_KWH es higiene float, muy por debajo de la resolución física.
  const FP_DUST_KWH = 1e-6;
  const generationComplete = intervalResults.length > 0
    && intervalResults.every(row => row.generation_kwh !== null);
  const exportComplete = intervalResults.length > 0
    && intervalResults.every(row => row.grid_export_kwh !== null);
  const generationSum = intervalResults.reduce((sum, row) => sum + (row.generation_kwh ?? 0), 0);
  const exportSum = intervalResults.reduce((sum, row) => sum + (row.grid_export_kwh ?? 0), 0);
  const aggregateSelf = generationSum - exportSum;
  const aggregateCoherent = aggregateSelf >= -FP_DUST_KWH;
  const correctedSelf = aggregateCoherent ? Math.max(aggregateSelf, 0) : null;
  // Consumo agregado por balance: con generation/import/export completos y
  // medición confiable (!meterSuspect), el total es gen-exp+imp aunque la
  // serie intervalaria quede PARTIAL (desfase MIN/meter: Arturo 6.4 + 17
  // nulls → 9.6). Solo el agregado; la serie observacional no se toca.
  // Balance materialmente negativo: null + UNAVAILABLE, nunca 0 fabricado.
  const importComplete = intervalResults.length > 0
    && intervalResults.every(row => row.grid_import_kwh !== null);
  const importSum = intervalResults.reduce((sum, row) => sum + (row.grid_import_kwh ?? 0), 0);
  const balanceApplies = generationComplete && importComplete && exportComplete && !meterSuspect;
  const aggregateBalance = generationSum - exportSum + importSum;
  const balanceCoherent = balanceApplies && aggregateBalance >= -FP_DUST_KWH;
  const balancedConsumption = balanceApplies && balanceCoherent
    ? Math.max(aggregateBalance, 0) : null;
  const rawInconsistentIntervals = intervalResults.filter(row => row.inconsistent).length;
  const inconsistentIntervals = aggregateCoherent ? 0 : rawInconsistentIntervals;
  // Ahorro por tramo tarifario: cada grupo con gen/exp completos aporta
  // self_grupo * rate_grupo. Nunca una sola tarifa para todo el período.
  // Grupo inválido (sin tarifa o self negativo) invalida el total legacy;
  // en métricas solo invalida su tramo.
  const savingsGroups = new Map();
  if (generationComplete && exportComplete) {
    for (const row of intervalResults) {
      const rate = numeric(row.tariff?.purchase_energy_rate);
      const key = rate === null ? '__notariff__' : `rate:${rate}`;
      let group = savingsGroups.get(key);
      if (!group) {
        group = { rate, generation: 0, export: 0, intervals: 0 };
        savingsGroups.set(key, group);
      }
      group.generation += row.generation_kwh;
      group.export += row.grid_export_kwh;
      group.intervals += 1;
    }
  }
  const groupSelf = group => group.generation - group.export;
  const groupValid = group => group.rate !== null && groupSelf(group) >= -FP_DUST_KWH;
  const groupSavings = group => Math.max(groupSelf(group), 0) * group.rate;
  const savingsGroupsList = [...savingsGroups.values()];
  const sourcePartialIntervals = intervalResults.filter(row => row.source_partial).length;
  const currency = commonValue(intervalResults.map(row => row.tariff?.currency ?? null));
  const mixedCurrency = currency === 'mixed';
  const singleOrNull = value => (value === 'mixed' ? null : value);
  const productionValue = mixedCurrency ? null : total('production_value');
  // Legacy savings con cobertura completa usa el autoconsumo corregido por
  // tramo (nunca el clampado por intervalo); con parcial se preserva strict.
  const selfConsumptionSavings = mixedCurrency ? null
    : (generationComplete && exportComplete
      ? (savingsGroupsList.every(groupValid)
        ? savingsGroupsList.reduce((sum, group) => sum + groupSavings(group), 0)
        : null)
      : total('self_consumption_savings'));
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
  // self usa el agregado corregido si gen/exp completos; si no, pares
  // válidos con el clamp conservador existente (sin estimar faltantes).
  const energyMetrics = Object.fromEntries(energyFields.map(field => [field, observedMetric(
    intervalResults.map(row => row[field]))]));
  // Consumo por balance cuando aplica: EXACT completo; balance incoherente:
  // UNAVAILABLE. El resto conserva la métrica observada (PARTIAL honesto).
  const consumptionMetricBase = !balanceApplies ? energyMetrics.consumption_kwh
    : (balanceCoherent
      ? {
        value: balancedConsumption,
        valid_intervals: intervalResults.length,
        total_intervals: intervalResults.length,
        complete: true,
        quality: 'EXACT',
      }
      : {
        value: null,
        valid_intervals: 0,
        total_intervals: intervalResults.length,
        complete: false,
        quality: 'UNAVAILABLE',
      });
  const pairSelf = intervalResults.map(row => row.self_consumption_kwh);
  let selfConsumptionMetric;
  if (generationComplete && exportComplete) {
    selfConsumptionMetric = aggregateCoherent
      ? {
        value: correctedSelf,
        valid_intervals: intervalResults.length,
        total_intervals: intervalResults.length,
        complete: true,
        quality: 'EXACT',
      }
      : {
        value: null,
        valid_intervals: 0,
        total_intervals: intervalResults.length,
        complete: false,
        quality: 'UNAVAILABLE',
      };
  } else {
    selfConsumptionMetric = observedMetric(pairSelf);
  }
  const perIntervalSavingsMetric = observedMetric(
    intervalResults.map(row => row.self_consumption_savings));
  let savingsMetricBase;
  if (mixedCurrency || !generationComplete || !exportComplete) {
    savingsMetricBase = perIntervalSavingsMetric;
  } else {
    const validGroups = savingsGroupsList.filter(groupValid);
    const validIntervals = validGroups.reduce((sum, group) => sum + group.intervals, 0);
    savingsMetricBase = {
      value: validGroups.length
        ? validGroups.reduce((sum, group) => sum + groupSavings(group), 0) : null,
      valid_intervals: validIntervals,
      total_intervals: intervalResults.length,
      complete: validIntervals === intervalResults.length && intervalResults.length > 0,
      quality: !validGroups.length ? 'UNAVAILABLE'
        : (validIntervals === intervalResults.length ? 'EXACT' : 'PARTIAL'),
    };
  }
  const exportObserved = observedMetric(
    intervalResults.map(row => row.export_value));
  // Beneficio observado: usa los valores de las métricas (corregidas), no la
  // suma por intervalo. Conteos conservadores (mínimo de ambos).
  const savingsForBenefit = savingsMetricBase;
  const benefitValue = savingsForBenefit.value !== null && exportObserved.value !== null
    ? savingsForBenefit.value + exportObserved.value : null;
  const benefitCounts = {
    valid_intervals: Math.min(savingsForBenefit.valid_intervals, exportObserved.valid_intervals),
    total_intervals: intervalResults.length,
    complete: savingsForBenefit.complete && exportObserved.complete,
  };
  const benefitObserved = {
    value: benefitValue,
    ...benefitCounts,
    quality: combineQuality(savingsForBenefit.quality, exportObserved.quality),
  };
  // Moneda mixta: los datos existen pero no son agregables. Se conserva el
  // conteo real y se fuerza value=null + quality UNAVAILABLE en dinero.
  const moneyMetric = observed => (mixedCurrency
    ? { ...observed, value: null, quality: 'UNAVAILABLE' } : observed);
  const savingsMetric = moneyMetric(savingsMetricBase);
  const exportValueMetric = moneyMetric(exportObserved);
  const benefitMetric = mixedCurrency
    ? { ...benefitObserved, value: null, quality: 'UNAVAILABLE' }
    : benefitObserved;
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
    consumption_kwh: suspectMetric(consumptionMetricBase, { nullable: false, monetary: false }),
    grid_import_kwh: suspectMetric(energyMetrics.grid_import_kwh, { nullable: false, monetary: false }),
    grid_export_kwh: suspectMetric(energyMetrics.grid_export_kwh, { nullable: false, monetary: false }),
    self_consumption_kwh: suspectMetric(selfConsumptionMetric, { nullable: true, monetary: false }),
    self_consumption_savings: suspectMetric(savingsMetric, { nullable: true, monetary: true }),
    export_value: allNoneCompensation ? exportValueMetric
      : suspectMetric(exportValueMetric, { nullable: true, monetary: true }),
    estimated_economic_benefit: suspectMetric(benefitMetric, { nullable: true, monetary: true }),
  };
  // Crédito generado (energy_credit): ENERGÍA, no dinero. Reutiliza la
  // inyección válida ya calculada (mismo value/quality/conteos, incluido
  // SUSPECT cuando la medición no está confirmada). Solo modalidad
  // energy_credit; otras modalidades conservan el comportamiento legacy.
  // Sin estimación de nulos ni valoración monetaria nueva.
  const energyCreditCompensation = commonValue(intervalResults
    .map(row => row.tariff?.export_compensation_type ?? null)) === 'energy_credit';
  metrics.energy_credit_generated_kwh = energyCreditCompensation
    ? { ...metrics.grid_export_kwh }
    : {
      value: null,
      valid_intervals: 0,
      total_intervals: intervalResults.length,
      complete: false,
      quality: 'UNAVAILABLE',
    };
  // Legacy consumption refleja el balance cuando aplica (nunca el strict
  // parcial); si no aplica, se preserva strictSum.
  const consumptionTotal = balanceApplies ? balancedConsumption : total('consumption_kwh');
  // Legacy self con cobertura completa refleja el agregado corregido (nunca
  // el clamp por intervalo); con parcial se preserva strictSum; agregado
  // incoherente (export > generation) es null, no 0 fabricado.
  const selfConsumptionTotal = !generationComplete || !exportComplete
    ? total('self_consumption_kwh')
    : correctedSelf;
  const status = !rows.length ? 'none'
    : missingEnergyIntervals || missingTariffIntervals || inconsistentIntervals
        || sourcePartialIntervals || mixedCurrency
      ? 'partial' : 'available';

  return {
    period,
    start,
    end,
    generation_kwh: total('generation_kwh'),
    consumption_kwh: consumptionTotal,
    self_consumption_kwh: selfConsumptionTotal,
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
