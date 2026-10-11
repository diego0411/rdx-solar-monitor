import { compensationValue, creditEstimatedValue } from './economicPresentation.js';

// ECO-04B: capa reutilizable de presentación confiable para reportes.
// Función pura sobre el contrato GET /plants/:id/economics. No duplica
// fórmulas del backend: solo lee valores + calidades y aplica la matriz
// ECO-04A (normal/provisional/warning/unavailable). Los valores crudos se
// conservan intactos; el redondeo ocurre únicamente en text.

// Estados por indicador: 'normal' | 'provisional' | 'warning' | 'unavailable'.
function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function coverageText(entry) {
  if (!entry || entry.quality !== 'PARTIAL' || !entry.total_intervals) return '';
  const percent = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 1 })
    .format(entry.valid_intervals / entry.total_intervals * 100);
  return `${entry.valid_intervals}/${entry.total_intervals} intervalos (${percent}%)`;
}

export function formatReportEnergy(value) {
  if (!isNum(value)) return '—';
  return `${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(value)} kWh`;
}

export function formatReportMoney(value, currency) {
  if (!isNum(value)) return '—';
  const amount = new Intl.NumberFormat('es-BO', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
  return currency === 'BOB' ? `Bs ${amount}` : `${amount} ${currency ?? ''}`.trim();
}

export function formatReportRate(value, currency = 'BOB') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const formatted = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 4 }).format(Number(value));
  return `${currency === 'BOB' ? 'Bs' : currency} ${formatted}/kWh`;
}

// Clasifica una entrada { value, quality, ... } del API. La generación no
// recibe SUSPECT del backend (medición intacta); el dinero con SUSPECT o
// UNAVAILABLE nunca se publica. PARTIAL conserva su cobertura.
export function classifyIndicator(entry, { inProgress = false, suspect = false } = {}) {
  if (!entry || entry.quality === 'UNAVAILABLE' || !isNum(entry.value)) {
    return { status: 'unavailable', coverage: '', suspect };
  }
  const coverage = coverageText(entry);
  if (entry.quality === 'SUSPECT') return { status: 'unavailable', coverage, suspect: true };
  if (entry.quality === 'PARTIAL') {
    return { status: inProgress ? 'provisional' : 'warning', coverage, suspect };
  }
  return { status: inProgress ? 'provisional' : 'normal', coverage, suspect };
}

function energyIndicator(summary, metrics, field, { inProgress, estimated = false }) {
  const entry = metrics?.[field] ?? null;
  const legacy = summary?.[field] ?? null;
  const raw = entry && isNum(entry.value) ? entry.value : (isNum(legacy) ? legacy : null);
  const view = entry ?? (isNum(legacy)
    ? { value: legacy, quality: 'EXACT', valid_intervals: 0, total_intervals: 0 } : null);
  const state = classifyIndicator(view, { inProgress });
  return { raw, text: formatReportEnergy(state.status === 'unavailable' ? null : raw), estimated, ...state };
}

function moneyIndicator(summary, metrics, field, legacyValue, { inProgress, currency }) {
  const entry = metrics?.[field] ?? null;
  const raw = entry && isNum(entry.value) ? entry.value : (isNum(legacyValue) ? legacyValue : null);
  const view = entry ?? (isNum(legacyValue)
    ? { value: legacyValue, quality: 'EXACT', valid_intervals: 0, total_intervals: 0 } : null);
  const state = classifyIndicator(view, { inProgress });
  const shown = state.status === 'unavailable' ? null : raw;
  return { raw, text: formatReportMoney(shown, currency), ...state };
}

// Contruye todos los indicadores listos para reporte. Nunca estima ni
// recalcula: si el API no trae un valor, el indicador es 'unavailable'.
export function buildReportIndicators(summary) {
  if (!summary || typeof summary !== 'object') {
    return { status: 'unavailable', inProgress: false, energy: {}, money: {}, credit: null, tariffs: null, coverage: null, data: null, disclaimers: [], monetaryPublishable: { publishable: false, reasons: ['sin-datos'] } };
  }
  const metrics = summary.metrics ?? {};
  const coverage = summary.coverage ?? {};
  const inProgress = coverage.period_in_progress === true;
  const currency = summary.currency ?? null;
  const inMixedCurrency = coverage.mixed_currency === true || currency === 'mixed';

  const energy = Object.fromEntries([
    ['generation_kwh', {}], ['consumption_kwh', {}],
    ['self_consumption_kwh', { estimated: true }],
    ['grid_import_kwh', {}], ['grid_export_kwh', {}],
  ].map(([field, opts]) => [field, energyIndicator(summary, metrics, field, { inProgress, ...opts })]));

  // Producción ($): depende solo de generación + tarifa; su estado sigue la
  // calidad de generación (el backend nunca la marca SUSPECT porque la
  // medición de generación queda intacta). Sin tarifa o con mixta es null.
  const genEntry = metrics.generation_kwh ?? null;
  const prodView = genEntry && isNum(summary.production_value)
    ? { ...genEntry, value: summary.production_value }
    : (isNum(summary.production_value)
      ? { value: summary.production_value, quality: 'EXACT', valid_intervals: 0, total_intervals: 0 } : null);
  const prodState = classifyIndicator(prodView, { inProgress });
  const production = {
    raw: isNum(summary.production_value) ? summary.production_value : null,
    text: formatReportMoney(null, currency),
    ...prodState,
  };
  if (inMixedCurrency && production.status !== 'unavailable') production.status = 'unavailable';
  if (production.status !== 'unavailable' && isNum(production.raw)) {
    production.text = formatReportMoney(production.raw, currency);
  }

  const money = {
    production_value: production,
    self_consumption_savings: moneyIndicator(summary, metrics, 'self_consumption_savings', summary.self_consumption_savings, { inProgress, currency }),
    export_value: moneyIndicator(summary, metrics, 'export_value', compensationValue(summary), { inProgress, currency }),
    estimated_economic_benefit: moneyIndicator(summary, metrics, 'estimated_economic_benefit', summary.estimated_economic_benefit, { inProgress, currency }),
  };
  if (inMixedCurrency) {
    for (const indicator of Object.values(money)) {
      if (indicator.status !== 'unavailable') { indicator.status = 'unavailable'; indicator.text = formatReportMoney(null, currency); }
    }
  }

  // Crédito: solo energy_credit usa la métrica explícita; el resto conserva
  // el legacy. Regla vigente del API (sin modificar): valorizado a precio
  // de compra, no a tarifa de exportación.
  const creditMode = summary.compensation_type === 'energy_credit';
  const creditEntry = creditMode ? (metrics.energy_credit_generated_kwh ?? null) : null;
  const creditRaw = creditEntry && isNum(creditEntry.value) ? creditEntry.value
    : (isNum(summary.export_credit_kwh) ? summary.export_credit_kwh : null);
  const creditView = creditEntry ?? (isNum(summary.export_credit_kwh)
    ? { value: summary.export_credit_kwh, quality: 'EXACT', valid_intervals: 0, total_intervals: 0 } : null);
  const creditState = creditMode || isNum(summary.export_credit_kwh)
    ? classifyIndicator(creditView, { inProgress }) : { status: 'unavailable', coverage: '', suspect: false };
  const creditValueRaw = creditMode || summary.compensation_type === 'mixed'
    ? creditEstimatedValue(summary) : null;
  const credit = {
    mode: summary.compensation_type ?? null,
    kwh: { raw: creditState.status === 'unavailable' ? null : creditRaw, text: formatReportEnergy(creditState.status === 'unavailable' ? null : creditRaw), ...creditState },
    // Etiqueta explícita de la regla vigente: precio de compra.
    value: { raw: creditValueRaw, text: formatReportMoney(creditValueRaw, currency), rule: creditMode ? 'purchase-price' : null },
  };

  const tariffs = {
    currency,
    purchase_energy_rate: { raw: summary.purchase_energy_rate ?? null, text: formatReportRate(summary.purchase_energy_rate, currency) },
    export_energy_rate: { raw: summary.export_energy_rate ?? null, text: formatReportRate(summary.export_energy_rate, currency) },
    compensation_type: summary.compensation_type ?? null,
  };

  const disclaimers = [
    { id: 'self-estimate', text: 'Autoconsumo estimado como generación menos exportación; en instalaciones con batería es una aproximación.' },
    { id: 'observed-not-complete', text: 'La disponibilidad de intervalos no demuestra por sí sola cobertura total del periodo.' },
  ];
  if (creditMode || summary.compensation_type === 'mixed') {
    disclaimers.push({ id: 'no-carryover', text: 'El crédito corresponde al periodo consultado y no incluye arrastre de periodos anteriores.' });
  }
  if (creditMode) {
    disclaimers.push({ id: 'credit-rule', text: 'Crédito valorizado a precio de compra según la regla vigente del API.' });
  }
  const providers = summary.data_observation?.providers;
  if (Array.isArray(providers) && providers.includes('growatt')) {
    disclaimers.push({ id: 'growatt-method', text: 'Planta Growatt: la energía se deriva de contadores del fabricante; los intervalos sin muestra válida quedan como ausencia de dato.' });
  }
  if (inProgress) {
    disclaimers.push({ id: 'in-progress', text: 'Período en curso: valores provisionales con los datos registrados hasta el momento.' });
  }

  // Puerta de publicación de totales monetarios (nunca definitivos aquí).
  const reasons = [];
  if (inMixedCurrency) reasons.push('moneda-mixta');
  if ((coverage.missing_tariff_intervals ?? 0) > 0) reasons.push('tarifa-incompleta');
  for (const [name, indicator] of Object.entries(money)) {
    if (indicator.status === 'unavailable') reasons.push(`${name}-no-disponible`);
  }
  if (inProgress) reasons.push('periodo-en-curso');
  const monetaryPublishable = { publishable: reasons.length === 0, reasons };

  const status = Object.values({ ...energy, ...money }).some(i => i.status === 'warning' || i.status === 'provisional')
    ? (inProgress ? 'provisional' : 'warning') : 'normal';
  return {
    status: Object.values({ ...energy, ...money }).some(i => i.status === 'unavailable') && status === 'normal' ? 'warning' : status,
    inProgress,
    period: { period: summary.period ?? null, start: summary.start ?? null, end: summary.end ?? null },
    energy, money, credit, tariffs,
    coverage: {
      status: coverage.status ?? null, intervals: coverage.intervals ?? 0,
      missing_energy_intervals: coverage.missing_energy_intervals ?? 0,
      missing_tariff_intervals: coverage.missing_tariff_intervals ?? 0,
      inconsistent_intervals: coverage.inconsistent_intervals ?? 0,
      source_partial_intervals: coverage.source_partial_intervals ?? 0,
      mixed_currency: inMixedCurrency, meter_suspect: coverage.meter_suspect === true,
      suspect_days: coverage.suspect_days ?? [],
    },
    data: summary.data_observation ? {
      rows: summary.data_observation.rows ?? null,
      first_interval_at: summary.data_observation.first_interval_at ?? null,
      last_interval_at: summary.data_observation.last_interval_at ?? null,
      last_stored_at: summary.data_observation.last_stored_at ?? null,
      providers: Array.isArray(providers) ? [...providers] : [],
      has_stored_data: summary.data_observation.has_stored_data ?? null,
    } : null,
    disclaimers,
    monetaryPublishable,
  };
}
