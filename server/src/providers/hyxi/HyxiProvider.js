import { getHyxiToken } from './hyxiAuth.js';
import { hyxiClient } from './hyxiClient.js';
import { HYXI_ENDPOINTS } from './hyxiConstants.js';
import { normalizeHyxiEnergyHistory } from './normalizeHyxiEnergyHistory.js';

export class HyxiProvider {
  constructor() {
    this.provider = 'hyxi';
  }

  async authenticate() {
    const { expiresAt } = await getHyxiToken();
    return {
      authenticated: true,
      expiresIn: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
    };
  }

  async getPlantAlarms(plantId, currentPage = 1, pageSize = 100) {
    const payload = await hyxiClient.post(HYXI_ENDPOINTS.plantAlarms, {
      plantId, currentPage, pageSize,
    });
    if (payload?.success !== true || payload.code !== '0') {
      throw new Error('Invalid HYXi plant alarms response');
    }
    return payload;
  }

  async getPlantPowerHistory(plantId, startTime) {
    const payload = await hyxiClient.post(HYXI_ENDPOINTS.plantPowerHistory, {
      plantId, startTime,
    });
    if (payload?.success !== true || payload.code !== '0') {
      throw new Error('Invalid HYXi plant power history response');
    }
    return payload;
  }

  async getPlantEnergyHistory(plantId, timeType, startTime) {
    const payload = await hyxiClient.post(HYXI_ENDPOINTS.plantEnergyHistory, {
      plantId, timeType, startTime,
    });
    if (payload?.success !== true || payload.code !== '0') {
      throw new Error('Invalid HYXi plant energy history response');
    }
    return normalizeHyxiEnergyHistory(payload);
  }

  async getPlantEnergySummary(plantId) {
    const payload = await hyxiClient.post(HYXI_ENDPOINTS.plantEnergySummary, { plantId });

    if (payload?.success !== true || payload.code !== '0') {
      throw new Error('Invalid HYXi plant energy summary response');
    }

    return payload;
  }

  async listDevices(plantId, { currentPage = 1, pageSize = 100 } = {}) {
    const payload = await hyxiClient.post(HYXI_ENDPOINTS.devices, {
      plantId,
      deviceType: '',
      currentPage,
      pageSize,
    });
    if (payload?.success !== true || payload.code !== '0'
        || !Array.isArray(payload.data?.deviceList)
        || !Number.isSafeInteger(payload.data?.totalRows) || payload.data.totalRows < 0) {
      throw new Error('Invalid HYXi devices response');
    }
    return {
      provider: this.provider,
      currentPage,
      pageSize,
      total: payload.data.totalRows,
      devices: payload.data.deviceList,
    };
  }

  async getDeviceRealtime(deviceSn) {
    const query = new URLSearchParams({ deviceSn });
    const payload = await hyxiClient.get(`${HYXI_ENDPOINTS.deviceRealtime}?${query}`);

    if (payload?.success !== true || payload.code !== '0') {
      throw new Error('Invalid HYXi device realtime response');
    }

    return payload;
  }

  async getDevice(deviceSn) {
    const query = new URLSearchParams({ deviceSn });
    const payload = await hyxiClient.get(`${HYXI_ENDPOINTS.deviceInfo}?${query}`);

    if (payload?.success !== true || payload.code !== '0') {
      throw new Error('Invalid HYXi device response');
    }

    return payload;
  }

  async getPlant(plantId) {
    const query = new URLSearchParams({ plantId });
    const payload = await hyxiClient.get(`${HYXI_ENDPOINTS.plantInfo}?${query}`);

    if (payload?.success !== true || payload.code !== '0') {
      throw new Error('Invalid HYXi plant response');
    }

    return payload;
  }

  async listPlants({ currentPage = 1, pageSize = 20 } = {}) {
    const payload = await hyxiClient.post(HYXI_ENDPOINTS.plants, {
      currentPage,
      pageSize,
    });

    if (payload?.success !== true || payload.code !== '0'
        || !Array.isArray(payload.data?.list)
        || !Number.isSafeInteger(payload.data?.totalRows) || payload.data.totalRows < 0) {
      throw new Error('Invalid HYXi plants response');
    }

    return {
      provider: this.provider,
      currentPage,
      pageSize,
      total: payload.data.totalRows,
      plants: payload.data.list,
    };
  }
}
