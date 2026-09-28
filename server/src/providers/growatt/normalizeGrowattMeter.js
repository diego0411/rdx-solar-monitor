function lostState(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

function lastUpdateMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeGrowattMeterEntry(entry, dataloggerSn) {
  const address = entry?.address ?? entry?.addr ?? null;
  return {
    datalogger_sn: dataloggerSn ?? entry?.datalogger_sn ?? entry?.datalogSn ?? null,
    address: address === null || address === undefined ? null : String(address),
    device_name: entry?.device_name ?? entry?.deviceName ?? null,
    device_type: entry?.device_type ?? entry?.deviceType ?? null,
    lost: lostState(entry?.lost),
    last_update: entry?.lastUpdateTime ?? entry?.last_update_time ?? null,
    raw: entry ?? null,
  };
}

// Un punto lógico de medición = datalogger_sn + address (el device_sn
// Growatt "meter" no es identidad: se repite entre plantas y entre
// reemplazos SDM→CHNT). Selección determinista e independiente del orden:
// activo (lost=false) > desconocido > perdido, luego mayor last_update,
// luego nombre/tipo como desempate final.
export function selectActiveMeter(rawEntries, dataloggerSn = null) {
  const normalized = (rawEntries ?? []).map(entry => normalizeGrowattMeterEntry(entry, dataloggerSn));
  const rank = entry => [
    entry.lost === false ? 0 : (entry.lost === null ? 1 : 2),
    -(lastUpdateMs(entry.last_update) ?? Number.NEGATIVE_INFINITY),
    String(entry.device_name ?? ''),
    String(entry.device_type ?? ''),
  ];
  const ordered = [...normalized].sort((left, right) => {
    const leftRank = rank(left);
    const rightRank = rank(right);
    for (let index = 0; index < leftRank.length; index += 1) {
      if (leftRank[index] < rightRank[index]) return -1;
      if (leftRank[index] > rightRank[index]) return 1;
    }
    return 0;
  });
  return { selected: ordered[0] ?? null, candidates: normalized };
}

export function meterIdentity(dataloggerSn, address) {
  return `growatt-meter:${dataloggerSn}:${address}`;
}

export function buildMeterDevice(plantId, selected, candidates) {
  const identity = meterIdentity(selected.datalogger_sn, selected.address);
  return {
    plant_id: plantId,
    provider: 'growatt',
    external_device_id: identity,
    serial_number: identity,
    name: null,
    model: selected.device_name,
    device_type: 'meter',
    // Misma semántica que los MIN: el meter aún no forma parte de la
    // telemetría latest, así que nace 'unknown' (devices.status es NOT NULL).
    status: 'unknown',
    active: true,
    parent_serial_number: selected.datalogger_sn,
    metadata: {
      datalogger_sn: selected.datalogger_sn,
      address: selected.address,
      meter_kind: selected.device_type,
      selected_candidate: {
        device_name: selected.device_name,
        device_type: selected.device_type,
        lost: selected.lost,
        last_update: selected.last_update,
      },
      candidates: candidates.map(entry => ({
        device_name: entry.device_name,
        device_type: entry.device_type,
        lost: entry.lost,
        last_update: entry.last_update,
      })),
    },
  };
}
