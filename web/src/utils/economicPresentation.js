export function shouldShowExportValue(summary) {
  if (!summary) return false;
  if (summary.compensation_type === 'monetary' || summary.compensation_type === 'mixed') return true;
  return summary.compensation_type === 'energy_credit'
    && typeof summary.export_value === 'number'
    && Number.isFinite(summary.export_value);
}
