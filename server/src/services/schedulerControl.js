export function schedulersEnabled(value) {
  return value === 'true';
}

export function startAutomaticSchedulers(enabled, start) {
  if (!enabled) return false;
  start();
  return true;
}
