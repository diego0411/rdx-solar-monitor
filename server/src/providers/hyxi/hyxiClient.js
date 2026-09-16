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

    let payload = null;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }
    if (!response.ok || (payload && typeof payload === 'object'
        && ((Object.hasOwn(payload, 'success') && payload.success !== true)
          || (Object.hasOwn(payload, 'code') && String(payload.code) !== '0')))) {
      const failure = new Error('Unsuccessful HYXi response');
      failure.httpStatus = response.status;
      failure.providerCode = payload?.code ?? payload?.error_code;
      failure.providerMsg = payload?.msg ?? payload?.message ?? payload?.error;
      throw failure;
    }
    return payload;
  } catch (error) {
    const failure = new Error('HYXi request failed');
    failure.httpStatus = error?.httpStatus;
    failure.providerCode = error?.providerCode;
    failure.providerMsg = error?.providerMsg;
    throw failure;
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
