export function theoreticalPanelCapacityKwp(panelCount, panelPowerW) {
  if (!Number.isInteger(panelCount) || panelCount <= 0
      || typeof panelPowerW !== 'number' || !Number.isFinite(panelPowerW)
      || panelPowerW <= 0) return null;
  return panelCount * panelPowerW / 1000;
}
