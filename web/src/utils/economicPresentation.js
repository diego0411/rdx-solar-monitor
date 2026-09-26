export function compensationValue(summary) {
  if (!summary) return null;
  return summary.export_compensation_value ?? summary.export_value ?? null;
}

export function creditEstimatedValue(summary) {
  if (!summary) return null;
  return summary.export_credit_estimated_value ?? null;
}

export function shouldShowExportValue(summary) {
  if (!summary) return false;
  if (summary.compensation_type === 'monetary' || summary.compensation_type === 'mixed') return true;
  if (summary.compensation_type !== 'energy_credit') return false;
  const value = compensationValue(summary);
  return typeof value === 'number' && Number.isFinite(value);
}
