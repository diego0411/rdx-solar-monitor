import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReportIndicators, classifyIndicator,
  formatReportEnergy, formatReportMoney,
} from '../src/utils/reportPresentation.js';
import * as presentation from '../src/utils/reportPresentation.js';

// ECO-04B: matriz ECO-04A sobre resúmenes sintéticos con forma del API.

const entry = (value, quality, valid = 10, total = 10) => (
  value === null || value === undefined
    ? { value: null, quality, valid_intervals: 0, total_intervals: total }
    : { value, quality, valid_intervals: valid, total_intervals: total }
);

function summaryShape(overrides = {}) {
  const exact = value => entry(value, 'EXACT');
  return {
    period: 'day', start: '2026-10-10', end: '2026-10-11',
    generation_kwh: 42.5, consumption_kwh: 30.2, self_consumption_kwh: 25.1,
    grid_import_kwh: 5.1, grid_export_kwh: 17.4,
    production_value: 63.75, self_consumption_savings: 37.65,
    export_value: 8.7, export_compensation_value: 8.7,
    export_credit_estimated_value: null, export_credit_kwh: null,
    estimated_economic_benefit: 46.35,
    currency: 'BOB', purchase_energy_rate: 1.5, export_energy_rate: 0.5,
    compensation_type: 'monetary',
    coverage: {
      status: 'available', intervals: 288, missing_energy_intervals: 0,
      missing_tariff_intervals: 0, inconsistent_intervals: 0,
      source_partial_intervals: 0, mixed_currency: false,
      period_in_progress: false, meter_suspect: false, suspect_days: [],
    },
    metrics: {
      generation_kwh: exact(42.5), consumption_kwh: exact(30.2),
      self_consumption_kwh: exact(25.1), grid_import_kwh: exact(5.1),
      grid_export_kwh: exact(17.4), self_consumption_savings: exact(37.65),
      export_value: exact(8.7), estimated_economic_benefit: exact(46.35),
    },
    data_observation: {
      rows: { total: 288 }, first_interval_at: '2026-10-10T00:00:00.000Z',
      last_interval_at: '2026-10-10T23:55:00.000Z', last_stored_at: '2026-10-11T00:05:00.000Z',
      providers: ['growatt'], has_stored_data: true,
    },
    ...overrides,
  };
}

test('1: EXACT muestra todo normal y publica dinero', () => {
  const report = buildReportIndicators(summaryShape());
  assert.equal(report.status, 'normal');
  assert.equal(report.energy.generation_kwh.status, 'normal');
  assert.equal(report.energy.self_consumption_kwh.estimated, true);
  assert.equal(report.money.estimated_economic_benefit.status, 'normal');
  assert.equal(report.monetaryPublishable.publishable, true);
  assert.deepEqual(report.monetaryPublishable.reasons, []);
  assert.ok(report.disclaimers.some(d => d.id === 'self-estimate'));
  assert.ok(report.disclaimers.some(d => d.id === 'growatt-method'));
});

test('2: PARTIAL advierte con cobertura y conserva crudo', () => {
  const shaped = summaryShape();
  shaped.metrics.generation_kwh = entry(30.25, 'PARTIAL', 200, 288);
  const report = buildReportIndicators(shaped);
  const indicator = report.energy.generation_kwh;
  assert.equal(indicator.status, 'warning');
  assert.equal(indicator.raw, 30.25);
  assert.ok(indicator.coverage.includes('200/288'));
  assert.equal(report.status, 'warning');
});

test('3: UNAVAILABLE y SUSPECT en dinero lo ocultan', () => {
  const shaped = summaryShape();
  shaped.metrics.self_consumption_savings = entry(null, 'UNAVAILABLE', 0, 288);
  shaped.metrics.export_value = { value: null, quality: 'SUSPECT', valid_intervals: 5, total_intervals: 288 };
  const report = buildReportIndicators(shaped);
  assert.equal(report.money.self_consumption_savings.status, 'unavailable');
  assert.equal(report.money.self_consumption_savings.text, '—');
  assert.equal(report.money.export_value.status, 'unavailable');
  assert.equal(report.monetaryPublishable.publishable, false);
  assert.ok(report.monetaryPublishable.reasons.some(r => r.includes('no-disponible')));
});

test('4: moneda mixta bloquea todos los totales', () => {
  const shaped = summaryShape({ currency: 'mixed' });
  shaped.coverage.mixed_currency = true;
  const report = buildReportIndicators(shaped);
  for (const indicator of Object.values(report.money)) assert.equal(indicator.status, 'unavailable');
  assert.equal(report.monetaryPublishable.publishable, false);
  assert.ok(report.monetaryPublishable.reasons.includes('moneda-mixta'));
  assert.equal(report.energy.generation_kwh.status, 'normal');
});

test('5: tarifa incompleta y periodo abierto impiden publicar', () => {
  const shaped = summaryShape();
  shaped.coverage.missing_tariff_intervals = 12;
  shaped.coverage.status = 'partial';
  shaped.coverage.period_in_progress = true;
  const report = buildReportIndicators(shaped);
  assert.equal(report.inProgress, true);
  assert.equal(report.energy.generation_kwh.status, 'provisional');
  assert.equal(report.monetaryPublishable.publishable, false);
  assert.ok(report.monetaryPublishable.reasons.includes('tarifa-incompleta'));
  assert.ok(report.monetaryPublishable.reasons.includes('periodo-en-curso'));
  assert.ok(report.disclaimers.some(d => d.id === 'in-progress'));
});

test('6: energy_credit expone kWh y regla de precio de compra', () => {
  const shaped = summaryShape({ compensation_type: 'energy_credit', export_credit_kwh: 17.4, export_credit_estimated_value: 26.1 });
  shaped.metrics.energy_credit_generated_kwh = entry(17.4, 'EXACT');
  const report = buildReportIndicators(shaped);
  assert.equal(report.credit.mode, 'energy_credit');
  assert.equal(report.credit.kwh.raw, 17.4);
  assert.equal(report.credit.value.rule, 'purchase-price');
  assert.ok(report.disclaimers.some(d => d.id === 'no-carryover'));
  assert.ok(report.disclaimers.some(d => d.id === 'credit-rule'));
});

test('7: none oculta crédito y conserva exportación en cero', () => {
  const shaped = summaryShape({ compensation_type: 'none', export_value: 0, export_compensation_value: 0 });
  shaped.metrics.export_value = entry(0, 'EXACT');
  const report = buildReportIndicators(shaped);
  assert.equal(report.credit.kwh.status, 'unavailable');
  assert.equal(report.money.export_value.raw, 0);
  assert.ok(!report.disclaimers.some(d => d.id === 'no-carryover'));
});

test('8: datos vacíos → no disponible con motivo', () => {
  const report = buildReportIndicators(null);
  assert.equal(report.status, 'unavailable');
  assert.equal(report.monetaryPublishable.publishable, false);
  assert.deepEqual(report.monetaryPublishable.reasons, ['sin-datos']);
  const empty = buildReportIndicators({ coverage: { status: 'none' }, metrics: {} });
  assert.equal(empty.energy.generation_kwh.status, 'unavailable');
});

test('9: redondeo solo al presentar, crudo intacto', () => {
  assert.equal(formatReportEnergy(42.567), '42,57 kWh');
  assert.equal(formatReportMoney(46.355, 'BOB'), 'Bs 46,36');
  const shaped = summaryShape();
  shaped.metrics.generation_kwh = entry(42.567, 'EXACT');
  const report = buildReportIndicators(shaped);
  assert.equal(report.energy.generation_kwh.raw, 42.567);
  assert.equal(report.energy.generation_kwh.text, '42,57 kWh');
  assert.equal(classifyIndicator(null, {}).status, 'unavailable');
});

const copyOf = (report, bucket) => presentation.buildReportCopy(report, bucket);

test('ECO-04F4: crédito energético y valoración parcial conservan coberturas distintas', () => {
  const shaped = summaryShape({ compensation_type: 'energy_credit', production_value: null,
    export_credit_kwh: null, export_credit_estimated_value: null, export_energy_rate: null });
  shaped.coverage.missing_tariff_intervals = 1502;
  shaped.metrics.self_consumption_savings = entry(23.282481621980693, 'PARTIAL', 737, 2265);
  shaped.metrics.export_value = entry(145.5684260805844, 'PARTIAL', 737, 2265);
  shaped.metrics.estimated_economic_benefit = entry(168.8509077025651, 'PARTIAL', 737, 2265);
  shaped.metrics.energy_credit_generated_kwh = entry(418.9000706747174, 'PARTIAL', 2160, 2265);
  const input = structuredClone(shaped);
  const report = buildReportIndicators(shaped);
  const snapshot = structuredClone(report);
  const copy = copyOf(report, 'day');
  assert.equal(copy.money?.production_value?.label, 'Valor de producción');
  assert.equal(copy.money?.export_value?.label, 'Valor estimado del crédito');
  assert.equal(copy.money?.export_value?.stateLabel, 'Parcial');
  assert.equal(copy.money?.export_value?.coverage, '737/2265 válidos (32,5%)');
  assert.equal(copy.credit?.stateLabel, 'Parcial');
  assert.equal(copy.credit?.coverage, '2160/2265 válidos (95,4%)');
  assert.equal(copy.creditValue?.text, 'Bs 145,57');
  assert.equal(copy.creditValue?.coverage, '737/2265 válidos (32,5%)');
  assert.equal(copy.compensation, 'Crédito energético');
  assert.equal(copy.exportRate, 'No aplica');
  assert.equal(copy.graphIntervals, 'Días del gráfico');
  assert.equal(copy.publicationWarning, 'Sin total completo: falta tarifa en parte del periodo; valor de producción no disponible.');
  assert.deepEqual(report, snapshot, 'la copia comercial no altera indicadores ni condiciones');
  assert.deepEqual(shaped, input, 'no se modifica el contrato recibido');
  assert.deepEqual(report.monetaryPublishable, { publishable: false,
    reasons: ['tarifa-incompleta', 'production_value-no-disponible'] });
});

test('ECO-04F4: EXACT no fabrica cobertura parcial y mantiene importe y publicación', () => {
  const shaped = summaryShape({ compensation_type: 'energy_credit', export_credit_kwh: 17.4,
    export_credit_estimated_value: 26.1 });
  shaped.metrics.energy_credit_generated_kwh = entry(17.4, 'EXACT');
  shaped.metrics.export_value = entry(26.1, 'EXACT');
  const report = buildReportIndicators(shaped);
  const copy = copyOf(report, 'month');
  assert.equal(copy.credit?.stateLabel, 'Normal');
  assert.equal(copy.credit?.coverage, '');
  assert.equal(copy.creditValue?.text, 'Bs 26,10');
  assert.equal(copy.creditValue?.coverage, '');
  assert.equal(copy.publicationWarning, '');
  assert.equal(copy.graphIntervals, 'Meses del gráfico');
  assert.equal(report.monetaryPublishable.publishable, true);
});

test('ECO-04F4: UNAVAILABLE y SUSPECT no se convierten en cero ni en crédito valorado', () => {
  for (const quality of ['UNAVAILABLE', 'SUSPECT']) {
    const shaped = summaryShape({ compensation_type: 'energy_credit', export_credit_kwh: null,
      export_credit_estimated_value: null });
    shaped.metrics.energy_credit_generated_kwh = entry(null, quality, 0, 2265);
    shaped.metrics.export_value = entry(null, quality, 0, 2265);
    const report = buildReportIndicators(shaped);
    const copy = copyOf(report, 'intraday');
    assert.equal(report.credit.kwh.text, '—');
    assert.equal(copy.credit?.stateLabel, 'No disponible');
    assert.equal(copy.creditValue?.text, '—');
    assert.equal(copy.creditValue?.stateLabel, 'No disponible');
    assert.equal(copy.graphIntervals, 'Intervalos del gráfico');
    assert.ok(!copy.publicationWarning?.includes('export_value'));
    assert.equal(report.monetaryPublishable.publishable, false);
  }
});

test('ECO-04F4: monetary y none conservan importes y etiquetas compatibles', () => {
  const monetary = buildReportIndicators(summaryShape());
  const moneyCopy = copyOf(monetary);
  assert.equal(moneyCopy.money?.export_value?.label, 'Valor de exportación');
  assert.equal(moneyCopy.compensation, 'Compensación monetaria');
  assert.equal(moneyCopy.exportRate, 'Bs 0,5/kWh');
  assert.equal(monetary.money.export_value.text, 'Bs 8,70');
  const shaped = summaryShape({ compensation_type: 'none', export_value: 0, export_compensation_value: 0 });
  shaped.metrics.export_value = entry(0, 'EXACT');
  const none = buildReportIndicators(shaped);
  const noneCopy = copyOf(none);
  assert.equal(noneCopy.compensation, 'Sin compensación');
  assert.equal(noneCopy.exportRate, 'No aplica');
  assert.equal(noneCopy.money?.export_value?.label, 'Valor de exportación');
  assert.equal(none.money.export_value.text, 'Bs 0,00', 'cero solo cuando existe en el contrato');
  const mixedCopy = copyOf(buildReportIndicators(summaryShape({ compensation_type: 'mixed' })));
  assert.equal(mixedCopy.compensation, 'mixed', 'modalidad sin etiqueta validada conserva el texto anterior');
  assert.equal(mixedCopy.exportRate, 'Bs 0,5/kWh');
});

test('ECO-04F4: motivos legibles, periodo en curso y proveedor no alteran los estados', () => {
  const shaped = summaryShape();
  shaped.coverage.period_in_progress = true;
  shaped.data_observation.providers = ['hyxi'];
  const report = buildReportIndicators(shaped);
  const copy = copyOf(report);
  assert.equal(copy.publicationWarning, 'Sin total completo: periodo en curso.');
  assert.equal(copy.money?.self_consumption_savings?.stateLabel, 'Provisional');
  assert.equal(report.money.self_consumption_savings.status, 'provisional');
  assert.ok(!report.disclaimers.some(d => d.id === 'growatt-method'));
  const growatt = buildReportIndicators(summaryShape());
  assert.match(growatt.disclaimers.find(d => d.id === 'growatt-method').text, /^Datos de origen Growatt:/);
  const unknown = copyOf({ ...report, monetaryPublishable: { publishable: false, reasons: ['internal_unknown'] } });
  assert.equal(unknown.publicationWarning, 'Sin total completo: información insuficiente.');
});
