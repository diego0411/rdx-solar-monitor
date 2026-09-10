import { env } from '../../config/env.js';
import { getHyxiToken } from './hyxiAuth.js';
import { REQUEST_TIMEOUT_MS } from './hyxiConstants.js';

async function request(method, path, body) {
  try {
    const baseUrl = new URL(env.HYXI_BASE_URL);
    const url = new URL(path, baseUrl);
    if (url.protocol !== 'https:' || url.origin !== baseUrl.origin
        || url.username || url.password) {
      throw new Error('Invalid HYXi URL');
    }

    const { accessToken } = await getHyxiToken();
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error('Unsuccessful HTTP response');
    }

    return response.status === 204 ? null : await response.json();
  } catch {
    throw new Error('HYXi request failed');
  }
}

export const hyxiClient = {
  get(path) {
    return request('GET', path);
  },
  post(path, body) {
    return request('POST', path, body);
  },
};
