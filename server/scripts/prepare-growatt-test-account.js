import { encryptGrowattToken, decryptGrowattToken } from '../src/providers/growatt/growattTokenCrypto.js';
import { supabase } from '../src/config/supabase.js';
import { createHash } from 'node:crypto';
import { env } from '../src/config/env.js';

const TEST_ACCOUNT_KEY = 'test-user';

function getDeviceSn() {
  const index = process.argv.indexOf('--device-sn');
  const value = index >= 0 ? process.argv[index + 1] : '';
  if (!value?.trim()) throw new Error('Usage: node scripts/prepare-growatt-test-account.js --device-sn <device_sn>');
  return value.trim();
}


async function main() {
  if (process.env.GROWATT_CIPHER_DIAGNOSTICS_ONLY === '1') {
    const { data: device, error: deviceError } = await supabase.from('devices')
      .select('growatt_account_id').eq('provider', 'growatt')
      .eq('serial_number', 'ZHP9F73148').single();
    if (deviceError || !device?.growatt_account_id) throw new Error('Diagnostic account lookup failed');
    const { data: account, error: accountError } = await supabase.from('growatt_accounts')
      .select('api_token_encrypted').eq('id', device.growatt_account_id).single();
    if (accountError || !account?.api_token_encrypted) throw new Error('Diagnostic encrypted value lookup failed');
    console.log(JSON.stringify({
      script_cipher_fingerprint: createHash('sha256').update(account.api_token_encrypted, 'utf8').digest('hex').slice(0, 8),
      script_db_decrypt_result: decryptGrowattToken(account.api_token_encrypted) === null ? 'error' : 'ok',
      script_decrypt_function: 'server/src/providers/growatt/growattTokenCrypto.js: decryptGrowattToken',
    }));
    return;
  }
  if (process.env.GROWATT_KEY_FINGERPRINT_ONLY === '1') {
    console.log(JSON.stringify({ script_key_fingerprint: createHash('sha256')
      .update(Buffer.from(env.GROWATT_TOKEN_ENCRYPTION_KEY, 'base64')).digest('hex').slice(0, 8) }));
    return;
  }
  const token = process.env.GROWATT_TEST_USER_TOKEN?.trim();
  if (!token) throw new Error('GROWATT_TEST_USER_TOKEN is required');
  const deviceSn = getDeviceSn();
  const encryptedToken = encryptGrowattToken(token);
  if (decryptGrowattToken(encryptedToken) !== token) {
    throw new Error('Growatt token round-trip verification failed; nothing was saved');
  }

  const { data: device, error: deviceLookupError } = await supabase.from('devices')
    .select('id, growatt_account_id').eq('provider', 'growatt').eq('serial_number', deviceSn).maybeSingle();
  if (deviceLookupError) throw new Error('Could not resolve a unique Growatt device by serial_number');
  if (!device) throw new Error('Growatt device not found by serial_number');

  const accountQuery = supabase.from('growatt_accounts').select('id, api_token_encrypted, updated_at');
  const { data: existingAccount, error: accountLookupError } = await (device.growatt_account_id
    ? accountQuery.eq('id', device.growatt_account_id)
    : accountQuery.eq('external_user_id', TEST_ACCOUNT_KEY)).maybeSingle();
  if (device.growatt_account_id && !existingAccount) throw new Error('Associated Growatt account could not be loaded');
  if (accountLookupError) throw new Error('Could not resolve a unique Growatt test account');

  let accountId = existingAccount?.id;
  const operation = accountId ? 'update' : 'insert';
  const fingerprint = value => value == null ? null : createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
  let writtenRow;
  if (accountId) {
    const { data, error } = await supabase.from('growatt_accounts').update({
      api_token_encrypted: encryptedToken,
      active: true,
      updated_at: new Date().toISOString(),
    }).eq('id', accountId).select('id, api_token_encrypted, updated_at').single();
    writtenRow = data;
    if (error || !data) throw new Error('Could not update Growatt test account or no row was updated');
  } else {
    const { data, error } = await supabase.from('growatt_accounts').insert({
      external_user_id: TEST_ACCOUNT_KEY,
      username: TEST_ACCOUNT_KEY,
      api_token_encrypted: encryptedToken,
      active: true,
    }).select('id, api_token_encrypted, updated_at').single();
    writtenRow = data;
    if (error || !data) throw new Error('Could not insert Growatt test account or no account id was returned');
    accountId = data.id;
  }

  const { data: readback, error: readbackError } = await supabase.from('growatt_accounts')
    .select('api_token_encrypted, updated_at').eq('id', accountId).single();
  console.log(JSON.stringify({
    account_id: accountId,
    operation,
    pre_cipher_fingerprint: fingerprint(existingAccount?.api_token_encrypted),
    post_cipher_fingerprint: fingerprint(writtenRow?.api_token_encrypted),
    row_returned: Boolean(writtenRow),
    updated_at_before: existingAccount?.updated_at ?? null,
    updated_at_after: writtenRow?.updated_at ?? null,
    readback_cipher_fingerprint: fingerprint(readback?.api_token_encrypted),
    readback_decrypt_result: !readbackError && readback
      && decryptGrowattToken(readback.api_token_encrypted) === token ? 'ok' : 'error',
  }));
  if (readbackError || !readback) throw new Error('Could not read back Growatt test account');

  const { data: associated, error: associationError } = await supabase.from('devices')
    .update({ growatt_account_id: accountId }).eq('id', device.id)
    .eq('provider', 'growatt').eq('serial_number', deviceSn)
    .select('id, growatt_account_id').single();
  if (associationError || !associated || associated.growatt_account_id !== accountId) {
    throw new Error('Could not associate Growatt device or no device was updated; test account exists, retry after correcting the update error');
  }

}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
