function validText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validMetadataValue(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  return text !== '' && text.toLowerCase() !== 'null';
}

export function normalizeGrowattDeviceCheck(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Number(payload?.result) !== 1) {
    return { valid: false };
  }

  const model = validText(payload?.model);
  const normalPower = numeric(payload?.normalPower);
  const metadata = {};
  for (const key of ['deviceType', 'dtc', 'haveMeter']) {
    if (validMetadataValue(payload?.[key])) metadata[key] = payload[key];
  }

  return {
    valid: true,
    model,
    rated_power_w: normalPower !== null && normalPower > 0 ? normalPower : null,
    metadata,
  };
}