export const HYXI_ENDPOINTS = Object.freeze({
  token: '/api/authorization/v1/token',
  plants: '/api/plant/v1/page',
  plantInfo: '/api/plant/v1/info',
  plantEnergySummary: '/api/plant/v1/queryPowerGeneration',
  plantEnergyHistory: '/api/plant/v1/queryPlantYieldStatistics',
  plantPowerHistory: '/api/plant/v1/queryPlantPowerStatistics',
  plantAlarms: '/api/plant/v1/plantAlarmPage',
  devices: '/api/plant/v1/devicePage',
  deviceInfo: '/api/device/v1/queryDeviceInfo',
  deviceRealtime: '/api/device/v1/queryDeviceData',
});

export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 15 * 1000;
