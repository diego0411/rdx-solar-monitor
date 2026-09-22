<script setup>
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import { apiFetch } from '../services/api.js';

const PAGE_SIZE = 6;

const plants = ref([]);
const loading = ref(true);
const error = ref('');

const search = ref('');
const provider = ref('');
const status = ref('');
const dataStatus = ref('');
const sort = ref('name');
const page = ref(1);

const controller = new AbortController();

const providerNames = { hyxi: 'HYXi', growatt: 'Growatt' };

const statuses = {
  online: 'En línea',
  offline: 'Sin conexión',
  alarm: 'Alarma',
  inactive: 'Inactiva',
  unknown: 'Desconocido',
};

const freshness = {
  fresh: 'Actual',
  stale: 'Atrasada',
  no_data: 'Sin datos',
};

const number = new Intl.NumberFormat('es-BO', {
  maximumFractionDigits: 2,
});

const date = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function formatValue(value, unit) {
  return (
    typeof value === 'number'
    && Number.isFinite(value)
  )
    ? `${number.format(value)} ${unit}`
    : '—';
}

function age(value) {
  if (value == null || !Number.isFinite(value)) {
    return 'Sin datos';
  }

  return value < 60
    ? `Hace ${number.format(value)} min`
    : `Hace ${number.format(Number((value / 60).toFixed(1)))} h`;
}

function lastData(value) {
  return (
    value
    && Number.isFinite(Date.parse(value))
  )
    ? date.format(new Date(value))
    : 'Sin datos';
}

const filteredPlants = computed(() => {
  const term = normalize(search.value.trim());

  const list = plants.value.filter(plant =>
    normalize(plant.name).includes(term)
    && (!provider.value
      || plant.provider === provider.value)
    && (!status.value
      || plant.status === status.value)
    && (!dataStatus.value
      || plant.data_status === dataStatus.value));

  const byField = {
    name: plant => String(plant.name ?? ''),
    generation: plant => plant.today_generation_kwh,
    power: plant => plant.current_power_w,
    capacity: plant => plant.capacity_kwp,
  }[sort.value];

  return [...list].sort((a, b) => {
    if (sort.value === 'name') {
      return byField(a).localeCompare(
        byField(b),
        'es',
        { sensitivity: 'base' },
      );
    }

    const aValue = byField(a);
    const bValue = byField(b);

    const aFinite =
      typeof aValue === 'number'
      && Number.isFinite(aValue);

    const bFinite =
      typeof bValue === 'number'
      && Number.isFinite(bValue);

    if (aFinite !== bFinite) {
      return aFinite ? -1 : 1;
    }

    if (!aFinite) return 0;

    return bValue - aValue;
  });
});

const totalPages = computed(() =>
  Math.max(
    1,
    Math.ceil(
      filteredPlants.value.length / PAGE_SIZE,
    ),
  ));

const pagePlants = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE;

  return filteredPlants.value.slice(
    start,
    start + PAGE_SIZE,
  );
});

const pageNumbers = computed(() => {
  const pages = [];

  for (let i = 1; i <= totalPages.value; i += 1) {
    pages.push(i);
  }

  return pages;
});

const pageRangeText = computed(() => {
  const total = filteredPlants.value.length;

  if (!total) return '0 de 0';

  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(
    page.value * PAGE_SIZE,
    total,
  );

  return `${start}–${end} de ${total}`;
});

function goToPage(target) {
  page.value = Math.min(
    totalPages.value,
    Math.max(1, target),
  );
}

watch(
  [search, provider, status, dataStatus, sort],
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
    const data = await apiFetch('/plants/overview', {
      signal: controller.signal,
    });

    if (!Array.isArray(data)) {
      throw new Error('Respuesta inválida');
    }

    plants.value = data;
  } catch {
    if (!controller.signal.aborted) {
      error.value =
        'No se pudieron cargar las plantas. '
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
      Monitoreo
    </p>

    <h1>
      Plantas
    </h1>

    <p>
      Consulta tus instalaciones solares en un solo lugar.
    </p>
  </header>

  <div
    v-if="loading"
    class="card"
    role="status"
  >
    Cargando plantas…
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
      aria-label="Filtros de plantas"
      @submit.prevent
    >
      <label>
        Nombre
        <input
          v-model="search"
          type="search"
          placeholder="Buscar planta"
        />
      </label>

      <label>
        Marca
        <select v-model="provider">
          <option value="">
            Todas
          </option>

          <option value="hyxi">
            HYXi
          </option>

          <option value="growatt">
            Growatt
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
        Ordenar
        <select v-model="sort">
          <option value="name">
            Nombre
          </option>

          <option value="generation">
            Generación de hoy
          </option>

          <option value="power">
            Potencia actual
          </option>

          <option value="capacity">
            Capacidad
          </option>
        </select>
      </label>
    </form>

    <p
      class="results-count"
      role="status"
    >
      {{ filteredPlants.length }} de
      {{ plants.length }} plantas
    </p>

    <p
      v-if="!filteredPlants.length"
      class="card empty-state"
    >
      {{
        plants.length
          ? 'No hay plantas que coincidan con los filtros.'
          : 'No hay plantas disponibles.'
      }}
    </p>

    <ul
      v-else
      class="plant-grid"
    >
      <li
        v-for="plant in pagePlants"
        :key="plant.id"
      >
        <RouterLink
          :to="`/plants/${plant.id}`"
          class="card plant-card"
          :aria-label="`Ver detalle de ${plant.name}`"
        >
          <header class="plant-head">
            <div class="plant-title">
              <h2>
                {{ plant.name }}
              </h2>

              <span class="provider">
                {{
                  providerNames[plant.provider]
                    ?? plant.provider
                }}
              </span>
            </div>

            <span class="open-label">
              Ver detalle →
            </span>
          </header>

          <div class="plant-badges">
            <span class="meta-label">
              Estado

              <span
                class="badge"
                :class="`state-${plant.status}`"
              >
                {{
                  statuses[plant.status]
                    ?? statuses.unknown
                }}
              </span>
            </span>

            <span class="meta-label">
              Telemetría

              <span
                class="badge"
                :class="`data-${plant.data_status}`"
              >
                {{
                  freshness[plant.data_status]
                    ?? freshness.no_data
                }}
              </span>
            </span>
          </div>

          <dl class="plant-metrics">
            <div>
              <dt>
                Capacidad
              </dt>

              <dd>
                {{ formatValue(plant.capacity_kwp, 'kWp') }}
              </dd>
            </div>

            <div>
              <dt>
                Potencia actual
              </dt>

              <dd>
                {{ formatValue(plant.current_power_w, 'W') }}
              </dd>
            </div>

            <div>
              <dt>
                Generación de hoy
              </dt>

              <dd>
                {{
                  formatValue(
                    plant.today_generation_kwh,
                    'kWh',
                  )
                }}
              </dd>
            </div>

            <div>
              <dt>
                Consumo de hoy
              </dt>

              <dd>
                {{
                  formatValue(
                    plant.today_consumption_kwh,
                    'kWh',
                  )
                }}
              </dd>
            </div>
          </dl>

          <footer class="plant-foot">
            <div
              v-if="plant.inverter_total != null"
              class="foot-metric"
            >
              <span>
                Total inversores
              </span>

              <strong>
                {{ plant.inverter_total }}
              </strong>
            </div>

            <div class="foot-metric foot-read">
              <span>
                Última lectura
              </span>

              <strong>
                {{ lastData(plant.last_data_at) }}
              </strong>

              <small
                v-if="plant.data_age_minutes != null"
              >
                {{ age(plant.data_age_minutes) }}
              </small>
            </div>
          </footer>
        </RouterLink>
      </li>
    </ul>

    <nav
      v-if="filteredPlants.length"
      class="pagination"
      aria-label="Paginación de plantas"
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
    repeat(auto-fit, minmax(180px, 1fr));
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

.plant-grid {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.plant-card {
  display: block;
  padding: 18px;
}

.plant-card:hover {
  border-color: var(--rdx-focus);
}

.plant-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.plant-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}

.plant-title h2 {
  margin: 0;
  font-size: 17px;
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

.open-label {
  margin-left: auto;
  white-space: nowrap;
  font-size: 12px;
  color: var(--rdx-accent);
  font-weight: 600;
}

.plant-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin-top: 12px;
}

.meta-label {
  font-size: 12px;
  color: var(--rdx-text-muted);
}

.badge {
  margin-left: 5px;
}

.plant-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px 16px;
  margin: 14px 0 0;
}

.plant-metrics dt {
  color: var(--rdx-text-muted);
  font-size: 11px;
}

.plant-metrics dd {
  margin: 3px 0 0;
  color: var(--rdx-text-strong);
  font-size: 16px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.plant-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 28px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--rdx-border);
}

.foot-metric {
  display: grid;
  gap: 2px;
}

.foot-metric span {
  color: var(--rdx-text-muted);
  font-size: 11px;
}

.foot-metric strong {
  color: var(--rdx-text-strong);
  font-size: 13px;
  font-weight: 700;
}

.foot-read {
  margin-left: auto;
}

.foot-read small {
  color: var(--rdx-text-faint);
  font-size: 11px;
}

@media (max-width: 980px) {
  .plant-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 420px) {
  .plant-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .plant-foot {
    gap: 8px 20px;
  }
}
</style>