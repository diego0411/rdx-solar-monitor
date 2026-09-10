import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { env } from '../../config/env.js';

function decodeKey() {
  const key = Buffer.from(env.GROWATT_TOKEN_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('GROWATT_TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function encryptGrowattToken(token) {
  const key = decodeKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptGrowattToken(encryptedToken) {
  if (process.env.GROWATT_CRYPTO_DIAGNOSTICS === '1') reportCryptoDiagnostic(encryptedToken);
  if (!encryptedToken || !env.GROWATT_TOKEN_ENCRYPTION_KEY) return null;
  const [ivText, tagText, ciphertext] = encryptedToken.split(':');
  if (!ivText || !tagText || !ciphertext) return null;
  try {
    const key = decodeKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// Temporary opt-in diagnostic: only fixed messages and non-secret metadata.
function reportCryptoDiagnostic(encryptedToken) {
  const parts = typeof encryptedToken === 'string' ? encryptedToken.split(':') : [];
  const validBase64 = value => typeof value === 'string' && value.length > 0
    && Buffer.from(value, 'base64').toString('base64') === value;
  const validFormat = parts.length === 3 && parts.every(validBase64)
    && Buffer.from(parts[0], 'base64').length === 12
    && Buffer.from(parts[1], 'base64').length === 16;
  const report = {
    encryption_key_present: Boolean(env.GROWATT_TOKEN_ENCRYPTION_KEY),
    encryption_key_decoded_bytes: Buffer.from(env.GROWATT_TOKEN_ENCRYPTION_KEY, 'base64').length,
    encrypted_token_present: Boolean(encryptedToken),
    encrypted_token_format: validFormat ? 'válido' : 'inválido',
    decrypt_result: 'error',
    error_name: null,
    error_message: null,
  };
  if (!report.encryption_key_present || report.encryption_key_decoded_bytes !== 32) {
    report.error_name = 'ConfigurationError';
    report.error_message = 'Encryption key is missing or does not decode to 32 bytes';
  } else if (!validFormat) {
    report.error_name = 'FormatError';
    report.error_message = 'Encrypted token format is invalid';
  } else {
    try {
      const decipher = createDecipheriv('aes-256-gcm', decodeKey(), Buffer.from(parts[0], 'base64'));
      decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
      decipher.update(Buffer.from(parts[2], 'base64'));
      decipher.final();
      report.decrypt_result = 'ok';
    } catch {
      report.error_name = 'DecryptionError';
      report.error_message = 'AES-GCM authentication or decryption failed';
    }
  }
  console.log(JSON.stringify(report));
}

