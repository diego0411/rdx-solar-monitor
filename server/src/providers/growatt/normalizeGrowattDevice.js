export function normalizeGrowattDevice(device) {
  const deviceSn = device?.deviceSn;
  if (deviceSn === undefined || deviceSn === null || !String(deviceSn).trim()) {
    throw new Error('Invalid Growatt device identity');
  }

  return {
    plant_id: null,
    provider: 'growatt',
    external_device_id: String(deviceSn),
    serial_number: String(deviceSn),
    device_type: device?.deviceType ?? null,
    active: true,
    metadata: {
      ...device,
      datalogger_sn: device?.datalogger_sn ?? device?.dataloggerSn ?? null,
    },
  };
}