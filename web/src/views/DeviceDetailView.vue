<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '../services/api.js';

const route = useRoute();

const detail = ref(null);
const loading = ref(true);
const error = ref('');

const statuses = {
  online: 'En línea',
  offline: 'Sin conexión',
  alarm: 'Alarma',
  inactive: 'Inactivo',
  unknown: 'Desconocido',
};

const freshness = {
  fresh: 'Actual',
  stale: 'Atrasada',
  no_data: 'Sin datos',
};

const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };

const typeLabels = {
  STRING_INVERTER: 'Inversor',
  HYBRID_INVERTER: 'Inversor híbrido',
  COLLECTOR: 'Comunicador',
  MIN: 'Inversor',
};

const number = new Intl.NumberFormat('es-BO', {
  maximumFractionDigits: 2,
});

function hasValue(value) {
  return value !== null && value !== undefined;
}

function typeLabel(value) {
  const key = String(value ?? '').toUpperCase();
  return typeLabels[key] ?? value;
}

function deviceTitle(device) {
  const name = device?.name != null ? String(device.name).trim() : '';
  const model = device?.model != null ? String(device.model).trim() : '';
  const serial = device?.serial_number != null
    ? String(device.serial_number).trim()
    : '';

  if (name && name !== serial) return name;
  if (model && model !== serial) return model;

  if (device?.provider === 'growatt'
    && String(device.device_type ?? '').toUpperCase() === 'MIN') {
    return 'Inversor Growatt';
  }

  return typeLabel(device?.device_type) || 'Dispositivo';
}

function power(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) return null;
  const watts = Number(value);
  return watts < 1000
    ? `${number.format(watts)} W`
    : `${number.format(Number((watts / 1000).toFixed(2)))} kW`;
}

function percent(value) {
  return `${number.format(Number(value))} %`;
}

function energy(value) {
  return `${number.format(Number(value))} kWh`;
}

function relative(value) {
  if (!Number.isFinite(Date.parse(value))) return null;
  const minutes = (Date.now() - Date.parse(value)) / 60000;
  if (minutes < 60) return `hace ${number.format(Math.max(0, Math.round(minutes)))} min`;
  return `hace ${number.format(Number((minutes / 60).toFixed(1)))} h`;
}

function dateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = part => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const isCollector = computed(() =>
  String(detail.value?.device?.device_type ?? '').toUpperCase() === 'COLLECTOR');

const isGrowatt = computed(() => detail.value?.device?.provider === 'growatt');

const isHybrid = computed(() =>
  detail.value?.device?.device_type === 'HYBRID_INVERTER');

const isHyxiInverter = computed(() => {
  const device = detail.value?.device;
  return device?.provider === 'hyxi'
    && ['STRING_INVERTER', 'HYBRID_INVERTER'].includes(device.device_type);
});

const lastReading = computed(() => {
  const collectedAt = detail.value?.device_latest_data?.collected_at;
  if (collectedAt == null) return 'Sin datos de telemetría';
  const ago = relative(collectedAt);
  const stamp = dateTime(collectedAt);
  if (!ago || !stamp) return 'Sin datos de telemetría';
  return `Última lectura: ${ago} · ${stamp}`;
});

const kpis = computed(() => {
  const latest = detail.value?.device_latest_data ?? {};
  const items = [];
  if (isCollector.value) return items;

  if (hasValue(latest.pv_power) && power(latest.pv_power)) {
    items.push({ label: 'Potencia FV', value: power(latest.pv_power) });
  }
  if (hasValue(latest.ac_power) && power(latest.ac_power)) {
    items.push({ label: 'Potencia AC', value: power(latest.ac_power) });
  }
  if (hasValue(latest.load_power) && power(latest.load_power)) {
    items.push({ label: 'Consumo', value: power(latest.load_power) });
  }
  if (isHybrid.value && hasValue(latest.battery_soc)) {
    items.push({ label: 'SOC batería', value: percent(latest.battery_soc) });
  }
  if (isGrowatt.value) {
    if (hasValue(latest.grid_import_power) && power(latest.grid_import_power)) {
      items.push({ label: 'Importación de red', value: power(latest.grid_import_power) });
    }
    if (hasValue(latest.grid_export_power) && power(latest.grid_export_power)) {
      items.push({ label: 'Exportación a red', value: power(latest.grid_export_power) });
    }
  }
  if (hasValue(latest.today_energy)) {
    items.push({ label: 'Energía hoy', value: energy(latest.today_energy) });
  }
  if (hasValue(latest.total_energy)) {
    items.push({ label: 'Energía total', value: energy(latest.total_energy) });
  }
  return items;
});

function pvString(latest, index) {
  const voltage = latest[`pv${index}_voltage`];
  const current = latest[`pv${index}_current`];
  const powerValue = latest[`pv${index}_power`];
  if (!hasValue(voltage) && !hasValue(current) && !hasValue(powerValue)) {
    return null;
  }
  return {
    voltage: hasValue(voltage) ? `${number.format(Number(voltage))} V` : null,
    current: hasValue(current) ? `${number.format(Number(current))} A` : null,
    power: hasValue(powerValue) ? `${number.format(Number(powerValue))} W` : null,
  };
}

const diagnostics = computed(() => {
  if (!isHyxiInverter.value) return null;
  const latest = detail.value?.device_latest_data ?? {};
  return {
    fv1: pvString(latest, 1),
    fv2: pvString(latest, 2),
    frequency: hasValue(latest.frequency)
      ? `${number.format(Number(latest.frequency))} Hz`
      : null,
    temperature: hasValue(latest.inverter_temperature)
      ? `${number.format(Number(latest.inverter_temperature))} °C`
      : null,
  };
});

const identityItems = computed(() => {
  const device = detail.value?.device ?? {};
  const items = [];
  if (hasValue(device.serial_number)) {
    items.push({ label: 'Número de serie', value: device.serial_number });
  }
  if (hasValue(device.model)) items.push({ label: 'Modelo', value: device.model });
  items.push({
    label: 'Proveedor',
    value: providerNames[device.provider] ?? device.provider,
  });
  items.push({ label: 'Tipo', value: typeLabel(device.device_type) });
  if (hasValue(device.rated_power_w)) {
    items.push({ label: 'Potencia nominal', value: power(device.rated_power_w) });
  }
  if (hasValue(device.rated_voltage_v)) {
    items.push({ label: 'Tensión nominal', value: `${number.format(Number(device.rated_voltage_v))} V` });
  }
  if (hasValue(device.hardware_version)) {
    items.push({ label: 'Hardware', value: device.hardware_version });
  }
  if (hasValue(device.software_version)) {
    items.push({ label: 'Software', value: device.software_version });
  }
  return items;
});

const deviceSignal = computed(() => {
  const device = detail.value?.device ?? {};
  const latest = detail.value?.device_latest_data ?? {};
  const signal = latest.device_status;
  if (!signal || signal === 'unknown' || signal === device.status) return null;
  return statuses[signal] ?? signal;
});

watch(() => route.params.id, async (id, previous, cleanup) => {
  const controller = new AbortController();
  cleanup(() => controller.abort());
  loading.value = true;
  error.value = '';
  detail.value = null;
  try {
    const data = await apiFetch(`/devices/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    });
    if (!data?.device) throw new Error('Respuesta inválida');
    if (!controller.signal.aborted) detail.value = data;
  } catch (failure) {
    if (!controller.signal.aborted) {
      error.value = failure.status === 404
        ? 'Dispositivo no encontrado.'
        : 'No se pudo cargar el dispositivo. Comprueba la conexión e inténtalo de nuevo.';
    }
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}, { immediate: true });
</script>

<template>
  <RouterLink
    class="back-link"
    to="/devices"
  >
    ← Volver a dispositivos
  </RouterLink>

  <p
    v-if="loading"
    class="card"
    role="status"
  >
    Cargando dispositivo…
  </p>

  <p
    v-else-if="error"
    class="card"
    role="alert"
  >
    {{ error }}
  </p>

  <div
    v-else-if="detail"
    class="detail"
  >
    <header class="page-header">
      <p class="eyebrow">
        Monitoreo multimarca
      </p>

      <h1>
        {{ deviceTitle(detail.device) }}
      </h1>

      <div class="badges">
        <span class="badge">
          {{ providerNames[detail.device.provider] ?? detail.device.provider }}
        </span>

        <span
          class="badge"
          :class="`state-${detail.device.status}`"
        >
          {{ statuses[detail.device.status] ?? statuses.unknown }}
        </span>

        <span
          class="badge"
          :class="`data-${detail.data_status}`"
        >
          {{ freshness[detail.data_status] ?? freshness.no_data }}
        </span>
      </div>

      <p class="subline">
        <strong>
          {{ typeLabel(detail.device.device_type) }}
        </strong>

        <span>·</span>

        <RouterLink
          v-if="detail.plant"
          :to="`/plants/${detail.plant.id}`"
        >
          {{ detail.plant.name }}
        </RouterLink>

        <span v-else>
          Sin planta asociada
        </span>
      </p>

      <p class="reading">
        {{ lastReading }}
      </p>

      <p
        v-if="deviceSignal"
        class="reading"
      >
        Señal de telemetría: {{ deviceSignal }}
      </p>
    </header>

    <template v-if="isCollector">
      <section class="card no-power">
        Sin telemetría de potencia
      </section>
    </template>

    <section
      v-else-if="kpis.length"
      class="kpis"
    >
      <article
        v-for="item in kpis"
        :key="item.label"
        class="card kpi"
      >
        <h2>
          {{ item.label }}
        </h2>

        <p class="value">
          {{ item.value }}
        </p>
      </article>
    </section>

    <section
      v-if="diagnostics"
      class="diag"
    >
      <h2 class="section-title">
        Diagnóstico eléctrico
      </h2>

      <div class="diag-grid">
        <article
          v-for="label in ['fv1', 'fv2']"
          :key="label"
        >
          <div
            v-if="diagnostics[label]"
            class="card diag-card"
          >
            <h3>
              {{ label.toUpperCase() }}
            </h3>

            <div class="diag-values">
              <span v-if="diagnostics[label].voltage">
                <strong>{{ diagnostics[label].voltage }}</strong>
                Tensión
              </span>
              <span v-if="diagnostics[label].current">
                <strong>{{ diagnostics[label].current }}</strong>
                Corriente
              </span>
              <span v-if="diagnostics[label].power">
                <strong>{{ diagnostics[label].power }}</strong>
                Potencia
              </span>
            </div>
          </div>
        </article>

        <article
          v-if="diagnostics.frequency"
          class="card diag-card"
        >
          <h3>
            Frecuencia
          </h3>

          <p class="diag-value">
            {{ diagnostics.frequency }}
          </p>
        </article>

        <article
          v-if="diagnostics.temperature"
          class="card diag-card"
        >
          <h3>
            Temperatura del inversor
          </h3>

          <p class="diag-value">
            {{ diagnostics.temperature }}
          </p>
        </article>
      </div>
    </section>

    <section class="identity">
      <h2 class="section-title">
        Identificación
      </h2>

      <div class="card">
        <dl>
          <div
            v-for="item in identityItems"
            :key="item.label"
          >
            <dt>
              {{ item.label }}
            </dt>

            <dd>
              {{ item.value }}
            </dd>
          </div>

          <div>
            <dt>
              Planta
            </dt>

            <dd>
              <RouterLink
                v-if="detail.plant"
                :to="`/plants/${detail.plant.id}`"
              >
                {{ detail.plant.name }}
              </RouterLink>

              <span v-else>
                Sin planta asociada
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <footer class="plant-link">
      <RouterLink
        v-if="detail.plant"
        :to="`/plants/${detail.plant.id}`"
      >
        Ver monitoreo de la planta →
      </RouterLink>
    </footer>
  </div>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 28px;
}

h1,
dd {
  overflow-wrap: anywhere;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.subline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 10px 0 0;
  color: var(--rdx-text-muted);
  font-size: 14px;
}

.subline strong {
  color: var(--rdx-accent);
  font-weight: 700;
}

.subline a {
  color: var(--rdx-accent);
  font-weight: 600;
  text-decoration: none;
}

.subline a:hover {
  text-decoration: underline;
}

.reading {
  margin: 10px 0 0;
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.no-power {
  color: var(--rdx-text-faint);
  font-size: 13px;
  font-style: italic;
}

.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  gap: 14px;
}

.kpi {
  padding: 18px;
}

.kpi h2 {
  margin: 0 0 10px;
  color: var(--rdx-text-muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
}

.value {
  margin: 0;
  color: var(--rdx-text-strong);
  font-size: 22px;
  font-weight: 700;
}

.section-title {
  margin: 0 0 14px;
  font-size: 15px;
  color: var(--rdx-text);
}

.diag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
  gap: 14px;
}

.diag-card {
  padding: 16px 18px;
}

.diag-card h3 {
  margin: 0 0 10px;
  color: var(--rdx-text-muted);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
}

.diag-values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.diag-values span {
  display: grid;
  gap: 2px;
  color: var(--rdx-text-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.diag-values strong {
  color: var(--rdx-text-strong);
  font-size: 15px;
  font-weight: 700;
}

.diag-value {
  margin: 0;
  color: var(--rdx-text-strong);
  font-size: 18px;
  font-weight: 700;
}

.identity dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
  gap: 16px 24px;
  margin: 0;
}

.identity .card {
  padding-top: 16px;
  padding-bottom: 18px;
}

.identity dt {
  color: var(--rdx-text-muted);
  font-size: 12px;
}

.identity dd {
  margin: 3px 0 0;
  color: var(--rdx-text-strong);
  font-weight: 700;
}

.identity a {
  color: var(--rdx-accent);
  font-weight: 700;
  text-decoration: none;
}

.identity a:hover {
  text-decoration: underline;
}

.plant-link {
  padding-top: 8px;
}

.plant-link a {
  color: var(--rdx-accent);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.plant-link a:hover {
  text-decoration: underline;
}

@media (max-width: 420px) {
  .diag-values {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
</style>