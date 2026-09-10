import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({
  path: fileURLToPath(new URL('../../.env', import.meta.url)),
  override: true,
  quiet: true,
});

const requiredVariables = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

for (const name of requiredVariables) {
  if (!process.env[name]?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

export const env = {
  PORT: Number(process.env.PORT || 3000),
  SUPABASE_URL: process.env.SUPABASE_URL.trim(),
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
  HYXI_BASE_URL: process.env.HYXI_BASE_URL?.trim() || 'https://open.hyxicloud.com',
  HYXI_ACCESS_KEY: process.env.HYXI_ACCESS_KEY?.trim() || '',
  HYXI_ACCESS_SECRET: process.env.HYXI_ACCESS_SECRET?.trim() || '',
  GROWATT_BASE_URL: process.env.GROWATT_BASE_URL?.trim() || 'https://openapi.growatt.com',
  GROWATT_API_TOKEN: process.env.GROWATT_API_TOKEN?.trim() || '',
  GROWATT_TOKEN_ENCRYPTION_KEY: process.env.GROWATT_TOKEN_ENCRYPTION_KEY?.trim() || '',
};
