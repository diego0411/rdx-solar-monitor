const devicePageStates = new Map([
  [1, 'offline'], [2, 'online'], [3, 'alarm'], [10, 'inactive'],
]);

export function normalizeHyxiDevicePage(device, plantId) {
  if (!device || typeof device.deviceSn !== 'string' || !device.deviceSn.trim()) {
    throw new Error('Invalid HYXi device serial number');
  }
  return {
    plant_id: plantId,
    provider: 'hyxi',
    serial_number: device.deviceSn,
    external_device_id: device.deviceSn,
    name: device.deviceName ?? null,
    device_type: device.deviceType ?? null,
    status: devicePageStates.get(device.deviceState) ?? 'unknown',
    software_version: device.swVer ?? null,
    hardware_version: device.hwVer ?? null,
    active: true,
    last_synced_at: new Date().toISOString(),
    metadata: device,
  };
}
