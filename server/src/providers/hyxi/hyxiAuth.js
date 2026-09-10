import { createHash, createHmac, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import {
  HYXI_ENDPOINTS,
  REQUEST_TIMEOUT_MS,
  TOKEN_REFRESH_MARGIN_MS,
} from './hyxiConstants.js';

let cachedToken = null;
let pendingToken = null;

export function createHyxiSignature({
  accessKey, accessSecret, timestamp, nonce, body,
  path = HYXI_ENDPOINTS.token, method = 'POST', token = '',
}) {
  const contentHash = createHash('sha512')
    .update(`grantType:${body.grantType}`)
    .digest('hex');
  const stringToSign = `${path}\n${method.toUpperCase()}\n${contentHash}\n`;
  const signInput = `${accessKey}${token}${timestamp}${nonce}${stringToSign}`;

  return createHmac('sha512', accessSecret).update(signInput).digest('base64');
}

export function createHyxiAuthHeaders(body) {
  if (!env.HYXI_ACCESS_KEY || !env.HYXI_ACCESS_SECRET) {
    throw new Error('HYXi credentials not configured');
  }

  const timestamp = String(Date.now());
  const nonce = randomBytes(4).toString('hex');
  const signature = createHyxiSignature({
    accessKey: env.HYXI_ACCESS_KEY,
    accessSecret: env.HYXI_ACCESS_SECRET,
    timestamp,
    nonce,
    body,
  });

  return {
    'Content-Type': 'application/json',
    AccessKey: env.HYXI_ACCESS_KEY,
    Timestamp: timestamp,
    Nonce: nonce,
    Sign: signature,
    'Sign-headers': 'grantType',
  };
}

async function requestToken() {
  const body = { grantType: 1 };
  const headers = createHyxiAuthHeaders(body);
  const requestedAt = Date.now();

  try {
    const url = new URL(HYXI_ENDPOINTS.token, env.HYXI_BASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('Invalid HYXi URL');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error('Unsuccessful token response');
    }

    const payload = await response.json();
    const expiresIn = Number(payload.data?.expires_in);
    if (payload.success !== true || payload.code !== '0'
        || typeof payload.data?.access_token !== 'string' || !payload.data.access_token.trim()
        || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new Error('Invalid token response');
    }

    const lifetimeMs = expiresIn * 1000;
    cachedToken = {
      accessToken: payload.data.access_token,
      expiresAt: requestedAt + lifetimeMs,
      refreshAt: requestedAt + lifetimeMs - Math.min(TOKEN_REFRESH_MARGIN_MS, lifetimeMs / 2),
    };
    return cachedToken;
  } catch {
    throw new Error('HYXi authentication failed');
  }
}

export async function getHyxiToken() {
  if (cachedToken && Date.now() < cachedToken.refreshAt) {
    return cachedToken;
  }

  if (!pendingToken) {
    pendingToken = requestToken().finally(() => {
      pendingToken = null;
    });
  }

  return pendingToken;
}
