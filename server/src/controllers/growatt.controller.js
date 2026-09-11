import { GrowattProvider } from '../providers/growatt/GrowattProvider.js';
import { syncGrowattPlants } from '../services/growattPlants.service.js';
import { linkNextGrowattPlantDevices } from '../services/growattDevices.service.js';
import { syncGrowattLatest } from '../services/growattLatest.service.js';

const provider = new GrowattProvider();

export async function getGrowattHealth(req, res) {
  try {
    return res.json(await provider.getHealth());
  } catch (error) {
    if (error.rateLimited) {
      return res.status(429).json({ authenticated: true, device_count: 0, rate_limited: true });
    }
    return res.status(502).json({ authenticated: false, device_count: 0 });
  }
}

export async function postGrowattSyncPlants(req, res) {
  try {
    return res.json(await syncGrowattPlants());
  } catch {
    return res.status(502).json({
      provider: 'growatt', fetched_users: 0, fetched_plants: 0,
      inserted: 0, updated: 0, failed: 1, errors: ['Growatt plant sync failed'],
    });
  }
}

export async function postGrowattSyncDevices(req, res) {
  try {
    return res.json(await linkNextGrowattPlantDevices());
  } catch (error) {
    if (error.cachedDataUnavailable) {
      return res.status(409).json({
        provider: 'growatt', cached_data_unavailable: true,
        fetched: 0, inserted: 0, updated: 0, failed: 0, errors: [],
      });
    }
    if (error.rateLimited) {
      return res.status(429).json({ provider: 'growatt', fetched: 0, inserted: 0, updated: 0, failed: 0, rate_limited: true });
    }
    return res.status(502).json({ provider: 'growatt', fetched: 0, inserted: 0, updated: 0, failed: 1 });
  }
}

export async function postGrowattRefreshDevicesCache(req, res) {
  try {
    const payload = await provider.queryDeviceList(1);
    const count = Number(payload?.data?.count);
    const devices = payload?.data?.data;
    return res.json({ count: Number.isFinite(count) ? count : (Array.isArray(devices) ? devices.length : 0) });
  } catch (error) {
    if (error.rateLimited) {
      return res.status(429).json({ error: 'Growatt rate limit' });
    }
    return res.status(502).json({ error: 'Growatt device cache refresh failed' });
  }
}

export async function postGrowattSyncLatest(req, res) {
  try {
    return res.json(await syncGrowattLatest());
  } catch {
    return res.status(502).json({
      processed: 0, updated: 0, no_data: 0, failed: 1,
      rate_limited: false, permission_denied: false, credential_missing: 0,
    });
  }
}
