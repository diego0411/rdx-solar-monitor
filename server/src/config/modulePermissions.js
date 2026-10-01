// Catálogo canónico de módulos (única definición backend).
// reports queda reservado: existe en catálogo y CHECK pero sin rutas
// funcionales ni UI hasta que el módulo nazca.
export const MODULE_PERMISSIONS = Object.freeze([
  'dashboard',
  'plants',
  'devices',
  'maintenance',
  'inventory',
  'reports',
]);

export function isKnownModule(value) {
  return MODULE_PERMISSIONS.includes(value);
}
