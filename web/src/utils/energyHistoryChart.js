export function toVisualEnergyPoint(point) {
  const provenance = point?.energy_provenance;
  return {
    ...point,
    consumption_kwh: provenance?.consumption_kwh?.depends_on_first_daily_counter === true
      ? null : point?.consumption_kwh,
    grid_import_kwh: provenance?.grid_import_kwh?.first_daily_counter === true
      ? null : point?.grid_import_kwh,
    grid_export_kwh: provenance?.grid_export_kwh?.first_daily_counter === true
      ? null : point?.grid_export_kwh,
  };
}
