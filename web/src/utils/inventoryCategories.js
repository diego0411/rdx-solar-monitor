export const inventoryCategoryLabels = Object.freeze({
  inverter: 'Inversor',
  solar_panel: 'Panel solar',
  smart_meter: 'Smart meter',
  battery: 'Batería',
  datalogger: 'Datalogger',
  protection: 'Protección',
  structure: 'Estructura',
  cable: 'Cable',
  other: 'Otros',
});

export const inventoryCategoryOptions = Object.freeze(
  Object.entries(inventoryCategoryLabels).map(([value, label]) => Object.freeze({ value, label })),
);

export function inventoryCategoryLabel(value) {
  return inventoryCategoryLabels[value] ?? value ?? '—';
}
