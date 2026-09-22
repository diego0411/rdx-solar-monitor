import { env } from '../../config/env.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export { decryptGrowattToken } from './growattTokenCrypto.js';

const DEVICE_LIST_PATH = '/v4/new-api/queryDeviceList';
const LAST_DATA_PATH = '/v4/new-api/queryLastData';
const HISTORICAL_DATA_PATH = '/v4/new-api/queryHistoricalData';
const DEVICE_LIST_CACHE_TTL_MS = 60000;
const LAST_DATA_CACHE_TTL_MS = 300000;
const USER_PLANT_CACHE_TTL_MS = 300000;
const DEVICE_CACHE_FILE = fileURLToPath(new URL('../../../.cache/growatt-devices.json', import.meta.url));
const USER_CACHE_FILE = fileURLToPath(new URL('../../../.cache/growatt-users.json', import.meta.url));
const deviceListCache = new Map();
const lastDataCache = new Map();
const userPlantCache = new Map();
let lastDeviceListRateLimited = false;


function cachePayload(devices) {
  return { data: { count: devices.length, data: devices } };
}

function loadDeviceCache() {
  if (deviceListCache.has(1) || !existsSync(DEVICE_CACHE_FILE)) return;
  try {
    const devices = JSON.parse(readFileSync(DEVICE_CACHE_FILE, 'utf8'));
    if (!Array.isArray(devices)) return;
    deviceListCache.set(1, {
      payload: cachePayload(devices), devices, expiresAt: 0,
    });
  } catch {
    // Ignore an unavailable or invalid development cache.
  }
}

function saveDeviceCache(devices) {
  mkdirSync(new URL('../../../.cache/', import.meta.url), { recursive: true });
  writeFileSync(DEVICE_CACHE_FILE, JSON.stringify(devices), 'utf8');
}

function getCachedDeviceCount() {
  const cached = deviceListCache.get(1);
  if (!cached) return null;
  const count = Number(cached.payload?.data?.count);
  const devices = cached.payload?.data?.data;
  return Number.isFinite(count) ? count : (Array.isArray(devices) ? devices.length : null);
}

export class GrowattProvider {
  constructor() {
    this.baseUrl = env.GROWATT_BASE_URL;
    this.apiToken = env.GROWATT_API_TOKEN;
    loadDeviceCache();
  }

  async getHealth() {
    return {
      configured: Boolean(this.apiToken),
      cached_device_count: getCachedDeviceCount(),
      rate_limited: lastDeviceListRateLimited,
    };
  }

  async queryDeviceList(page, { forceCached = false } = {}) {
    const cached = deviceListCache.get(page);
    if (forceCached) {
      if (cached) return cached.payload;
      const error = new Error('Growatt cached device data unavailable');
      error.cachedDataUnavailable = true;
      error.statusCode = 409;
      throw error;
    }
    if (cached && cached.expiresAt > Date.now()) return cached.payload;

    const url = new URL(DEVICE_LIST_PATH, this.baseUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        token: this.apiToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ page: String(page) }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error('Growatt request failed');
    }

    let payload = await response.json();
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (Number(payload?.code) === 102 || Number(payload?.error_code) === 102) {
      lastDeviceListRateLimited = true;
      if (cached) return cached.payload;
      const error = new Error('Growatt rate limit');
      error.rateLimited = true;
      error.statusCode = 429;
      throw error;
    }
    if (payload?.code !== 0 && payload?.error_code !== 0) {
      throw new Error('Growatt device list response failed');
    }
    lastDeviceListRateLimited = false;
    const devices = Array.isArray(payload?.data?.data) ? payload.data.data : [];
    if (page === 1) saveDeviceCache(devices);
    deviceListCache.set(page, {
      payload, devices, expiresAt: Date.now() + DEVICE_LIST_CACHE_TTL_MS,
    });
    return payload;
  }

  async listDevices({ forceCached = false } = {}) {
    const devices = [];
    const pageSize = 100;
    let page = 1;
    let total = null;

    for (;;) {
      const payload = await this.queryDeviceList(page, { forceCached });

      const rows = Array.isArray(payload?.data?.data) ? payload.data.data : [];
      total = Number(payload?.data?.count);
      devices.push(...rows);
      if (!Number.isFinite(total) || devices.length >= total || rows.length < pageSize) break;
      page += 1;
    }

    return devices;
  }

  async listPlantDevices(plantId) {
    const url = new URL('/v1/device/list', this.baseUrl);
    url.search = new URLSearchParams({
      plant_id: String(plantId), page: '1', perpage: '100',
    });
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', token: this.apiToken },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Growatt plant devices request failed');

    const payload = await response.json();
    if (Number(payload?.error_code) === 10012) {
      const error = new Error('Growatt rate limit');
      error.rateLimited = true;
      throw error;
    }
    if (payload?.code !== 0 && payload?.error_code !== 0) {
      throw new Error('Growatt plant devices response failed');
    }
    return Array.isArray(payload?.data?.devices) ? payload.data.devices : [];
  }

  async checkDeviceBySn(deviceSn) {
    const url = new URL('/v1/device/check/sn', this.baseUrl);
    url.search = new URLSearchParams({ dataloggerSn: String(deviceSn) });
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', token: this.apiToken },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Growatt device check request failed');
    let payload = await response.json();
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (Number(payload?.code) === 102 || Number(payload?.error_code) === 102) {
      const error = new Error('Growatt rate limit');
      error.rateLimited = true;
      throw error;
    }
    return payload;
  }

  async deviceTlxDataInfo(deviceSn) {
    const url = new URL('/v1/device/tlx/tlx_data_info', this.baseUrl);
    url.search = new URLSearchParams({ device_sn: String(deviceSn) });
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', token: this.apiToken },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Growatt TLX data info request failed');
    let payload = await response.json();
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (Number(payload?.code) === 102 || Number(payload?.error_code) === 102) {
      const error = new Error('Growatt rate limit');
      error.rateLimited = true;
      throw error;
    }
    return payload;
  }

  async plantDetails(plantId) {
    const url = new URL('/v1/plant/details', this.baseUrl);
    url.search = new URLSearchParams({ plant_id: String(plantId) });
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', token: this.apiToken },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Growatt plant details request failed');
    let payload = await response.json();
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (Number(payload?.code) === 102 || Number(payload?.error_code) === 102) {
      const error = new Error('Growatt rate limit');
      error.rateLimited = true;
      throw error;
    }
    if (payload?.code !== 0 && payload?.error_code !== 0) {
      throw new Error('Growatt plant details response failed');
    }
    return payload?.data;
  }

  async queryLastData(deviceType, deviceSns, apiToken) {
    const cacheKey = `${deviceType}:${apiToken}`;
    const cached = lastDataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { payload: cached.payload, rateLimited: false };
    }

    const url = new URL(LAST_DATA_PATH, this.baseUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        token: apiToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ deviceType, deviceSn: deviceSns.join(',') }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error('Growatt latest data request failed');

    const payload = await response.json();
    if (Number(payload?.code) === 101 && payload?.message === 'PERMISSION_DENIED') {
      const error = new Error('Growatt permission denied');
      error.permissionDenied = true;
      error.statusCode = 403;
      throw error;
    }
    if (Number(payload?.code) === 102 || Number(payload?.error_code) === 102) {
      if (cached) return { payload: cached.payload, rateLimited: true };
      const error = new Error('Growatt rate limit');
      error.rateLimited = true;
      error.statusCode = 429;
      throw error;
    }
    if (payload?.code !== 0 && payload?.error_code !== 0) {
      throw new Error('Growatt latest data response failed');
    }
    lastDataCache.set(cacheKey, { payload, expiresAt: Date.now() + LAST_DATA_CACHE_TTL_MS });
    return { payload, rateLimited: false };
  }

  async queryHistoricalData(deviceSn, date, apiToken = this.apiToken) {
    const url = new URL(HISTORICAL_DATA_PATH, this.baseUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        token: apiToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ deviceType: 'min', deviceSn: String(deviceSn), date }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error('Growatt historical data request failed');

    let payload = await response.json();
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (Number(payload?.code) === 102 || Number(payload?.error_code) === 102) {
      const error = new Error(payload?.message || payload?.error_msg || 'FREQUENTLY_ACCESS');
      error.rateLimited = true;
      error.frequentAccess = true;
      error.statusCode = 429;
      throw error;
    }
    if (payload?.code !== 0 && payload?.error_code !== 0) {
      throw new Error('Growatt historical data response failed');
    }
    return payload;
  }

  async listPlants() {
    const plants = [];
    const perpage = 100;
    let page = 1;
    let total = null;

    for (;;) {
      const url = new URL('/v1/plant/list', this.baseUrl);
      url.search = new URLSearchParams({ page: String(page), perpage: String(perpage) });
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', token: this.apiToken },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) throw new Error('Growatt plants request failed');

      const payload = await response.json();
      if (payload?.code !== 0 && payload?.error_code !== 0) {
        throw new Error('Growatt plants response failed');
      }

      const rows = Array.isArray(payload?.data?.data) ? payload.data.data : [];
      total = Number(payload?.data?.count);
      plants.push(...rows);
      if (!Number.isFinite(total) || plants.length >= total || rows.length < perpage) break;
      page += 1;
    }

    return plants;
  }

  async listUsers() {
    if (existsSync(USER_CACHE_FILE)) {
      try {
        const cached = JSON.parse(readFileSync(USER_CACHE_FILE, 'utf8'));
        if (Array.isArray(cached?.data?.c_user)) return cached.data.c_user;
      } catch {
        // Ignore an invalid development cache and fetch users once.
      }
    }

    const url = new URL('/v1/user/c_user_list', this.baseUrl);
    url.search = new URLSearchParams({ page: '1', perpage: '100' });
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', token: this.apiToken },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Growatt users request failed');
    let payload = await response.json();
    if (typeof payload === 'string') payload = JSON.parse(payload);
    if (Number(payload?.code) === 102 || Number(payload?.error_code) === 102) {
      const error = new Error('Growatt rate limit');
      error.rateLimited = true;
      throw error;
    }
    if (payload?.error_code !== 0) {
      throw new Error('Growatt users response failed');
    }
    const users = Array.isArray(payload?.data?.c_user) ? payload.data.c_user : [];
    if (users.length) {
      mkdirSync(new URL('../../../.cache/', import.meta.url), { recursive: true });
      writeFileSync(USER_CACHE_FILE, JSON.stringify({ data: { c_user: users, count: users.length } }), 'utf8');
    }
    return users;
  }

  async listUserPlants(userName) {
    const cached = userPlantCache.get(userName);
    if (cached && cached.expiresAt > Date.now()) return cached.plants;

    const url = new URL('/v1/plant/user_plant_list', this.baseUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json', token: this.apiToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ user_name: userName, page: '1', perpage: '100' }),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Growatt user plants request failed');
    const payload = await response.json();
    if (Number(payload?.code) === 102 || Number(payload?.error_code) === 102) {
      const error = new Error('Growatt rate limit');
      error.rateLimited = true;
      throw error;
    }
    if (payload?.code !== 0 && payload?.error_code !== 0) {
      throw new Error('Growatt user plants response failed');
    }
    const plants = Array.isArray(payload?.data?.plants) ? payload.data.plants
      : (Array.isArray(payload?.data) ? payload.data : []);
    userPlantCache.set(userName, { plants, expiresAt: Date.now() + USER_PLANT_CACHE_TTL_MS });
    return plants;
  }
}
