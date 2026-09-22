<script setup>
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import { apiFetch } from '../services/api.js';

const PAGE_SIZE = 8;

const devices = ref([]);
const loading = ref(true);
const error = ref('');

const search = ref('');
const provider = ref('');
const status = ref('');
const dataStatus = ref('');
const deviceType = ref('');
const sort = ref('lectura');
const page = ref(1);

const controller = new AbortController();

const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };

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

const typeLabels = {
  STRING_INVERTER: 'Inversor',
  HYBRID_INVERTER: 'Inversor híbrido',
  COLLECTOR: 'Comunicador',
  MIN: 'Inversor',
};

const number = new Intl.NumberFormat('es-BO', {
  maximumFractionDigits: 2,
});

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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

function hasValue(value) {
  return value !== null && value !== undefined;
}

function metricCount(device) {
  return (hasValue(device.pv_power) ? 1 : 0)
    + (hasValue(device.ac_power) ? 1 : 0)
    + (hasValue(device.load_power) ? 1 : 0)
    + (hasValue(device.battery_soc) ? 1 : 0);
}

function power(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) {
    return null;
  }
  const watts = Number(value);
  return watts < 1000
    ? `${number.format(watts)} W`
    : `${number.format(Number((watts / 1000).toFixed(2)))} kW`;
}

function soc(value) {
  if (!hasValue(value) || !Number.isFinite(Number(value))) {
    return null;
  }
  return `${number.format(Number(value))} %`;
}

function relative(value) {
  if (value == null || !Number.isFinite(Date.parse(value))) {
    return 'Sin datos de telemetría';
  }
  const minutes = (Date.now() - Date.parse(value)) / 60000;
  if (minutes < 60) return `Hace ${number.format(Math.max(0, Math.round(minutes)))} min`;
  return `Hace ${number.format(Number((minutes / 60).toFixed(1)))} h`;
}

const isCollector = device =>
  String(device.device_type ?? '').toUpperCase() === 'COLLECTOR';

const filteredDevices = computed(() => {
  const term = normalize(search.value.trim());

  const list = devices.value.filter(device =>
    normalize(
      `${device.model ?? ''} ${device.serial_number ?? ''} ${device.plant_name ?? ''}`,
    ).includes(term)
    && (!provider.value
      || device.provider === provider.value)
    && (!status.value
      || device.status === status.value)
    && (!dataStatus.value
      || device.data_status === dataStatus.value)
    && (!deviceType.value
      || (device.device_type ?? '') === deviceType.value));

  if (sort.value === 'plant' || sort.value === 'model') {
    const field = sort.value === 'plant' ? 'plant_name' : 'model';
    return [...list].sort((a, b) =>
      String(a[field] ?? '').localeCompare(
        String(b[field] ?? ''),
        'es',
        { sensitivity: 'base' },
      ));
  }

  return [...list].sort((a, b) => {
    const aTime = Date.parse(a.collected_at ?? '');
    const bTime = Date.parse(b.collected_at ?? '');
    const aFinite = Number.isFinite(aTime);
    const bFinite = Number.isFinite(bTime);
    if (aFinite !== bFinite) return aFinite ? -1 : 1;
    if (!aFinite) return 0;
    return bTime - aTime;
  });
});

const totalPages = computed(() =>
  Math.max(
    1,
    Math.ceil(filteredDevices.value.length / PAGE_SIZE),
  ));

const pageDevices = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;
  return filteredDevices.value.slice(start, start + PAGE_SIZE);
});

const pageNumbers = computed(() => {
  const pages = [];
  for (let i = 1; i <= totalPages.value; i += 1) pages.push(i);
  return pages;
});

const pageRangeText = computed(() => {
  const total = filteredDevices.value.length;
  if (!total) return '0 de 0';
  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(page.value * PAGE_SIZE, total);
  return `${start}–${end} de ${total}`;
});

function goToPage(target) {
  page.value = Math.min(totalPages.value, Math.max(1, target));
}

watch(
  [search, provider, status, dataStatus, deviceType, sort],
  () => {
    page.value = 1;
  },
);

watch(totalPages, pages => {
  if (page.value > pages) {
    page.value = pages;
  }
});

onMounted(async () => {
  try {
    const data = await apiFetch('/devices', {
      signal: controller.signal,
    });

    if (!Array.isArray(data)) {
      throw new Error('Respuesta inválida');
    }

    devices.value = data;
  } catch {
    if (!controller.signal.aborted) {
      error.value =
        'No se pudieron cargar los dispositivos. '
        + 'Comprueba la conexión con el servidor '
        + 'y vuelve a cargar la página.';
    }
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => controller.abort());
</script>

<template>
  <header class="page-header">
    <p class="eyebrow">
      Monitoreo multimarca
    </p>

    <h1>
      Dispositivos
    </h1>

    <p>
      Consulta los dispositivos de todos tus proveedores.
    </p>
  </header>

  <div
    v-if="loading"
    class="card"
    role="status"
  >
    Cargando dispositivos…
  </div>

  <div
    v-else-if="error"
    class="card"
    role="alert"
  >
    {{ error }}
  </div>

  <template v-else>
    <form
      class="filters card"
      aria-label="Filtros de dispositivos"
      @submit.prevent
    >
      <label>
        Buscar
        <input
          v-model="search"
          type="search"
          placeholder="Modelo, serie o planta"
        />
      </label>

      <label>
        Proveedor
        <select v-model="provider">
          <option value="">
            Todos
          </option>

          <option
            v-for="(label, key) in providerNames"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </label>

      <label>
        Estado
        <select v-model="status">
          <option value="">
            Todos
          </option>

          <option
            v-for="(label, key) in statuses"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </label>

      <label>
        Telemetría
        <select v-model="dataStatus">
          <option value="">
            Todas
          </option>

          <option
            v-for="(label, key) in freshness"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </label>

      <label>
        Tipo
        <select v-model="deviceType">
          <option value="">
            Todos
          </option>

          <option
            v-for="type in [...new Set(devices.map(d => d.device_type).filter(Boolean))].sort()"
            :key="type"
            :value="type"
          >
            {{ typeLabel(type) }}
          </option>
        </select>
      </label>

      <label>
        Ordenar
        <select v-model="sort">
          <option value="lectura">
            Última lectura
          </option>

          <option value="plant">
            Planta
          </option>

          <option value="model">
            Modelo
          </option>
        </select>
      </label>
    </form>

    <p
      class="results-count"
      role="status"
    >
      {{ filteredDevices.length }} de
      {{ devices.length }} dispositivos
    </p>

    <p
      v-if="!filteredDevices.length"
      class="card empty-state"
    >
      {{
        devices.length
          ? 'No hay dispositivos que coincidan con los filtros.'
          : 'No hay dispositivos disponibles.'
      }}
    </p>

    <ul
      v-else
      class="device-grid"
    >
      <li
        v-for="device in pageDevices"
        :key="device.id"
      >
        <article
          class="card device-card"
          :class="{ 'device-card--sparse': metricCount(device) < 2 }"
        >
          <header class="device-head">
            <div class="device-title">
              <h2>
                {{ deviceTitle(device) }}
              </h2>

              <span class="provider">
                {{
                  providerNames[device.provider]
                    ?? device.provider
                }}
              </span>
            </div>
          </header>

          <div class="device-badges">
            <span class="meta-label">
              Estado

              <span
                class="badge"
                :class="`state-${device.status}`"
              >
                {{
                  statuses[device.status]
                    ?? statuses.unknown
                }}
              </span>
            </span>

            <span class="meta-label">
              Telemetría

              <span
                class="badge"
                :class="`data-${device.data_status}`"
              >
                {{
                  freshness[device.data_status]
                    ?? freshness.no_data
                }}
              </span>
            </span>
          </div>

          <p class="device-sub">
            <strong>
              {{ typeLabel(device.device_type) }}
            </strong>

            <span>·</span>

            <RouterLink
              v-if="device.plant_id"
              :to="`/plants/${device.plant_id}`"
            >
              {{ device.plant_name ?? 'Planta' }}
            </RouterLink>

            <span v-else>
              Sin planta asociada
            </span>
          </p>

          <dl
            v-if="metricCount(device) > 0"
            class="device-metrics"
          >
            <div v-if="hasValue(device.pv_power)">
              <dt>
                Potencia FV
              </dt>

              <dd>
                {{ power(device.pv_power) }}
              </dd>
            </div>

            <div v-if="hasValue(device.ac_power)">
              <dt>
                Potencia AC
              </dt>

              <dd>
                {{ power(device.ac_power) }}
              </dd>
            </div>

            <div v-if="hasValue(device.load_power)">
              <dt>
                Consumo
              </dt>

              <dd>
                {{ power(device.load_power) }}
              </dd>
            </div>

            <div v-if="hasValue(device.battery_soc)">
              <dt>
                Batería
              </dt>

              <dd>
                {{ soc(device.battery_soc) }}
              </dd>
            </div>
          </dl>

          <p
            v-else-if="isCollector(device)"
            class="no-power"
          >
            Sin telemetría de potencia
          </p>

          <footer class="device-foot">
            <div class="foot-metric">
              <span>
                N.º de serie
              </span>

              <strong>
                {{ device.serial_number ?? 'Sin datos' }}
              </strong>
            </div>

            <div class="foot-metric foot-read">
              <span>
                Última lectura
              </span>

              <strong>
                {{ relative(device.collected_at) }}
              </strong>
            </div>
          </footer>

          <RouterLink
            class="detail-link"
            :to="`/devices/${device.id}`"
          >
            Ver detalle →
          </RouterLink>
        </article>
      </li>
    </ul>

    <nav
      v-if="filteredDevices.length"
      class="pagination"
      aria-label="Paginación de dispositivos"
    >
      <button
        class="page-btn"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      >
        ‹ Anterior
      </button>

      <ol class="page-numbers">
        <li
          v-for="p in pageNumbers"
          :key="p"
        >
          <button
            class="page-btn page-number"
            :class="{ 'is-current': p === page }"
            :aria-current="p === page ? 'page' : null"
            @click="goToPage(p)"
          >
            {{ p }}
          </button>
        </li>
      </ol>

      <button
        class="page-btn"
        :disabled="page >= totalPages"
        @click="goToPage(page + 1)"
      >
        Siguiente ›
      </button>

      <span
        class="page-range"
        role="status"
      >
        {{ pageRangeText }}
      </span>
    </nav>
  </template>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns:
    repeat(auto-fit, minmax(170px, 1fr));
  gap: 16px;
  padding: 22px;
}

.filters label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
}

.results-count {
  margin: 18px 0 14px;
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.empty-state {
  padding: 24px;
}

.device-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.device-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.device-card--sparse {
  padding: 12px 18px;
  gap: 10px;
}

.device-head {
  display: flex;
  gap: 12px;
}

.device-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}

.device-title h2 {
  margin: 0;
  font-size: 16px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.provider {
  text-transform: uppercase;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .05em;
  color: var(--rdx-text-muted);
}

.device-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}

.meta-label {
  font-size: 12px;
  color: var(--rdx-text-muted);
}

.badge {
  margin-left: 5px;
}

.device-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 0;
  padding-top: 2px;
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.device-sub strong {
  color: var(--rdx-accent);
  font-weight: 700;
}

.device-sub a {
  color: var(--rdx-accent);
  font-weight: 600;
  text-decoration: none;
}

.device-sub a:hover {
  text-decoration: underline;
}

.device-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin: 0;
}

.device-metrics dt {
  color: var(--rdx-text-muted);
  font-size: 11px;
}

.device-metrics dd {
  margin: 3px 0 0;
  color: var(--rdx-text-strong);
  font-size: 15px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.no-power {
  margin: 0;
  color: var(--rdx-text-faint);
  font-size: 13px;
  font-style: italic;
}

.device-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 20px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--rdx-border);
}

.foot-metric {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.foot-metric span {
  color: var(--rdx-text-muted);
  font-size: 11px;
}

.foot-metric strong {
  color: var(--rdx-text-strong);
  font-size: 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.foot-read {
  margin-left: auto;
}

.detail-link {
  align-self: flex-start;
  color: var(--rdx-accent);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.detail-link:hover {
  text-decoration: underline;
}

@media (max-width: 980px) {
  .device-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 420px) {
  .device-metrics {
    grid-template-columns: 1fr;
  }

  .foot-read {
    margin-left: 0;
  }
}
</style>