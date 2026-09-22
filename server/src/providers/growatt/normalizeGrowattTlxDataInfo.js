function validText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.toLowerCase() !== 'null' ? text : null;
}

export function normalizeGrowattTlxDataInfo(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Number(payload?.error_code) !== 0) {
    return { valid: false };
  }
  const data = payload?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false };
  }

  const software_version = validText(data?.fwVersion);
  const innerVersion = validText(data?.innerVersion);
  const communicationVersion = validText(data?.communicationVersion);
  const hwVersion = validText(data?.hwVersion);
  const modelText = validText(data?.modelText);

  const metadata = {};
  if (innerVersion) metadata.innerVersion = innerVersion;
  if (communicationVersion) metadata.communicationVersion = communicationVersion;

  return {
    valid: true,
    software_version,
    hwVersion,
    modelText,
    metadata,
  };
}