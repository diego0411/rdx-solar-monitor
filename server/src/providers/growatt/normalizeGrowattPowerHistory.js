import { parseGrowattTimestamp } from './growattStates.js';

const fields = {
  pac: 'generation_power_w',
  pacToLocalLoad: 'consumption_power_w',
  pacToUserTotal: 'grid_import_power_w',
  pacToGridTotal: 'grid_export_power_w',
  chargePowerOfBattery: 'battery_charge_power_w',
  disChargePowerOfBattery: 'battery_discharge_power_w',
};

// Glitch demostrado (auditoría 7 plantas / 7576 muestras / 156 casos):
// pacToGridTotal = pac + load en lugar de pac - load + import.
// Distribución bimodal: error de balance ≈0 o muy grande; 50 W separa
// las clases sin tocar telemetría normal.
const POWER_BALANCE_TOLERANCE_W = 50;
// Evidencia del glitch solo con import≈0: no generalizar a muestras con
// importación significativa.
const IMPORT_NEAR_ZERO_TOLERANCE_W = 50;
// Coincidencia reported≈pac+load: solo precisión float32/telemetría
// (auditoría: desviación 0.00 en 156/156). Combinada con balanceError>50
// y expected>=0, el patrón es concluyente; la física real no puede
// producirlo con import≈0.
const PATTERN_MATCH_TOLERANCE_W = 1;

function numeric(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function correctedGridExport(rawData, reported) {
  if (reported === null) return null;
  const pac = numeric(rawData?.pac);
  const load = numeric(rawData?.pacToLocalLoad);
  const imported = numeric(rawData?.pacToUserTotal);
  if (pac === null || load === null || imported === null) return reported;
  if (Math.abs(imported) > IMPORT_NEAR_ZERO_TOLERANCE_W) return reported;
  const expected = pac - load + imported;
  // expected<0 es régimen importador o muestra corrupta (p.ej. dropout de
  // pac): mantener el dato recibido, nunca clampear ni corregir.
  if (expected < 0) return reported;
  const balanceError = Math.abs(pac - (load + reported - imported));
  if (balanceError <= POWER_BALANCE_TOLERANCE_W) return reported;
  if (Math.abs(reported - (pac + load)) > PATTERN_MATCH_TOLERANCE_W) return reported;
  return expected;
}

function pointsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  if (Array.isArray(payload?.data?.datas)) return payload.data.datas;
  return [];
}

export function normalizeGrowattPowerHistory(payload, plantTimezone) {
  return pointsOf(payload).map(rawData => {
    const mapped = Object.fromEntries(Object.entries(fields).map(([source, target]) => [
      target, numeric(rawData?.[source]),
    ]));
    // Solo grid_export_power_w puede corregirse; generation/load/import y
    // raw_data permanecen intactos. Sin flag: raw_data debe seguir pristine
    // para la derivación energética y el contrato persistido no cambia.
    mapped.grid_export_power_w = correctedGridExport(rawData, mapped.grid_export_power_w);
    return {
      interval_start: parseGrowattTimestamp(
        rawData?.time,
        plantTimezone,
      ),
      ...mapped,
      raw_data: rawData,
    };
  }).filter(point => point.interval_start && Object.values(fields)
    .some(field => point[field] !== null));
}
