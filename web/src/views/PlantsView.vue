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

const plantSummary = computed(() => ({
  total: plants.value.length,
  online: plants.value.filter(plant => plant.status === 'online').length,
  offline: plants.value.filter(plant => plant.status === 'offline').length,
  alarm: plants.value.filter(plant => plant.status === 'alarm').length,
}));

function percentage(value) {
  return plantSummary.value.total
    ? Math.round((value / plantSummary.value.total) * 100)
    : 0;
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
  <div class="plants-view">
    <header class="plants-header">
      <h1>Plantas</h1>
      <p>Monitorea todas tus instalaciones solares</p>
    </header>

    <div v-if="loading" class="card page-state" role="status">
      Cargando plantas…
    </div>

    <div v-else-if="error" class="card page-state error-state" role="alert">
      {{ error }}
    </div>

    <template v-else>
      <section class="summary-grid" aria-label="Resumen de plantas">
        <article class="summary-card">
          <span class="summary-icon summary-total" aria-hidden="true">⌁</span>
          <div>
            <span>Total de plantas</span>
            <strong>{{ plantSummary.total }}</strong>
            <small>Instalaciones registradas</small>
          </div>
        </article>

        <article class="summary-card">
          <span class="summary-icon"><i class="status-dot state-online" /></span>
          <div>
            <span>En línea</span>
            <strong>{{ plantSummary.online }}</strong>
            <small>{{ percentage(plantSummary.online) }}% del total</small>
          </div>
        </article>

        <article class="summary-card">
          <span class="summary-icon"><i class="status-dot state-offline" /></span>
          <div>
            <span>Sin conexión</span>
            <strong>{{ plantSummary.offline }}</strong>
            <small>{{ percentage(plantSummary.offline) }}% del total</small>
          </div>
        </article>

        <article class="summary-card">
          <span class="summary-icon"><i class="status-dot state-alarm" /></span>
          <div>
            <span>Con alarma</span>
            <strong>{{ plantSummary.alarm }}</strong>
            <small>{{ percentage(plantSummary.alarm) }}% del total</small>
          </div>
        </article>
      </section>

      <form class="filters card" aria-label="Filtros de plantas" @submit.prevent>
        <label class="search-filter">
          <span class="sr-only">Nombre</span>
          <span class="control-icon" aria-hidden="true">⌕</span>
          <input v-model="search" type="search" placeholder="Buscar planta por nombre…" />
        </label>

        <label>
          <span class="sr-only">Marca</span>
          <select v-model="provider">
            <option value="">Todas las marcas</option>
            <option value="hyxi">HYXi</option>
            <option value="growatt">Growatt</option>
          </select>
        </label>

        <label>
          <span class="sr-only">Estado</span>
          <select v-model="status">
            <option value="">Todos los estados</option>
            <option v-for="(label, key) in statuses" :key="key" :value="key">
              {{ label }}
            </option>
          </select>
        </label>

        <label>
          <span class="sr-only">Telemetría</span>
          <select v-model="dataStatus">
            <option value="">Toda la telemetría</option>
            <option v-for="(label, key) in freshness" :key="key" :value="key">
              {{ label }}
            </option>
          </select>
        </label>

        <label>
          <span class="sr-only">Ordenar</span>
          <select v-model="sort">
            <option value="name">Nombre (A - Z)</option>
            <option value="generation">Generación de hoy</option>
            <option value="power">Potencia actual</option>
            <option value="capacity">Capacidad</option>
          </select>
        </label>
      </form>

      <p class="results-count" role="status">
        <strong>{{ filteredPlants.length }}</strong>
        {{ filteredPlants.length === 1 ? 'planta' : 'plantas' }}
        <span v-if="filteredPlants.length !== plants.length">de {{ plants.length }}</span>
      </p>

      <p v-if="!filteredPlants.length" class="card empty-state">
        {{ plants.length
          ? 'No hay plantas que coincidan con los filtros.'
          : 'No hay plantas disponibles.' }}
      </p>

      <ul v-else class="plant-grid">
        <li v-for="plant in pagePlants" :key="plant.id">
          <article class="card plant-card">
            <header class="plant-head">
              <span class="provider-mark" :class="`provider-${plant.provider}`">
                {{ providerNames[plant.provider] ?? plant.provider }}
              </span>

              <div class="plant-title">
                <h2>{{ plant.name }}</h2>
                <span class="provider">
                  {{ providerNames[plant.provider] ?? plant.provider }}
                </span>
              </div>

              <span class="badge state-badge" :class="`state-${plant.status}`">
                <i class="status-dot" aria-hidden="true" />
                {{ statuses[plant.status] ?? statuses.unknown }}
              </span>
            </header>

            <dl class="plant-metrics">
              <div>
                <span class="metric-icon" aria-hidden="true">▦</span>
                <dt>Capacidad</dt>
                <dd>{{ formatValue(plant.capacity_kwp, 'kWp') }}</dd>
              </div>
              <div>
                <span class="metric-icon" aria-hidden="true">ϟ</span>
                <dt>Potencia actual</dt>
                <dd>{{ formatValue(plant.current_power_w, 'W') }}</dd>
              </div>
              <div>
                <span class="metric-icon" aria-hidden="true">▥</span>
                <dt>Generación hoy</dt>
                <dd>{{ formatValue(plant.today_generation_kwh, 'kWh') }}</dd>
              </div>
              <div>
                <span class="metric-icon" aria-hidden="true">⌂</span>
                <dt>Consumo hoy</dt>
                <dd>{{ formatValue(plant.today_consumption_kwh, 'kWh') }}</dd>
              </div>
            </dl>

            <footer class="plant-foot">
              <div class="foot-metric inverter-metric">
                <span class="foot-icon" aria-hidden="true">▤</span>
                <span>Total inversores</span>
                <strong>{{ plant.inverter_total != null ? plant.inverter_total : '—' }}</strong>
              </div>

              <div class="foot-metric telemetry-metric">
                <span class="foot-icon" aria-hidden="true">⌁</span>
                <span>Telemetría</span>
                <strong :class="`telemetry-${plant.data_status}`">
                  {{ freshness[plant.data_status] ?? freshness.no_data }}
                </strong>
              </div>

              <div class="foot-metric reading-metric">
                <span class="foot-icon" aria-hidden="true">◷</span>
                <span>Última lectura</span>
                <strong>{{ lastData(plant.last_data_at) }}</strong>
                <small v-if="plant.data_age_minutes != null">
                  {{ age(plant.data_age_minutes) }}
                </small>
              </div>

              <RouterLink
                :to="`/plants/${plant.id}`"
                class="detail-link"
                :aria-label="`Ver detalle de ${plant.name}`"
              >
                Ver detalle <span aria-hidden="true">→</span>
              </RouterLink>
            </footer>
          </article>
        </li>
      </ul>

      <nav v-if="filteredPlants.length" class="pagination" aria-label="Paginación de plantas">
        <button class="page-btn" :disabled="page <= 1" @click="goToPage(page - 1)">
          ‹ Anterior
        </button>
        <ol class="page-numbers">
          <li v-for="p in pageNumbers" :key="p">
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
        <button class="page-btn" :disabled="page >= totalPages" @click="goToPage(page + 1)">
          Siguiente ›
        </button>
        <span class="page-range" role="status">{{ pageRangeText }}</span>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.plants-view { width: 100%; }
.plants-header { margin-bottom: 20px; }
.plants-header h1 { font-size: 31px; }
.plants-header p { margin: 3px 0 0; font-size: 15px; }
.page-state { padding: 24px; color: var(--rdx-text-muted); }
.error-state { border-color: var(--rdx-danger-soft); }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
.summary-card { display: flex; align-items: center; gap: 16px; min-width: 0; min-height: 112px; padding: 18px 20px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-lg); background: var(--rdx-surface); box-shadow: var(--rdx-shadow-sm); }
.summary-icon { display: grid; place-items: center; flex: 0 0 48px; width: 48px; height: 48px; border-radius: 50%; background: var(--rdx-background); color: var(--rdx-primary); font-size: 28px; font-weight: 700; }
.summary-total { background: var(--rdx-primary-soft); }
.summary-card > div { min-width: 0; display: grid; }
.summary-card span:not(.summary-icon) { font-size: 13px; color: var(--rdx-text); }
.summary-card strong { color: var(--rdx-text-strong); font-size: 30px; line-height: 1.2; font-weight: 650; }
.summary-card small { margin-top: 3px; color: var(--rdx-text-muted); font-size: 12px; }
.status-dot { display: inline-block; width: 10px; height: 10px; flex: 0 0 10px; border-radius: 50%; background: currentColor; }
.summary-icon .status-dot { width: 18px; height: 18px; }
.summary-icon .state-online { color: var(--rdx-success); }
.summary-icon .state-offline { color: #f2a20b; background: currentColor; }
.summary-icon .state-alarm { color: #df3f3f; background: currentColor; }
.filters { display: grid; grid-template-columns: minmax(220px, 1.55fr) repeat(4, minmax(150px, 1fr)); gap: 12px; padding: 10px; margin-bottom: 17px; border-radius: var(--rdx-radius-md); }
.filters label { position: relative; min-width: 0; }
.filters input, .filters select { min-height: 40px; border-color: var(--rdx-border); font-size: 13px; }
.search-filter input { padding-left: 40px; }
.control-icon { position: absolute; left: 14px; top: 50%; z-index: 1; transform: translateY(-50%); color: var(--rdx-primary); font-size: 23px; line-height: 1; pointer-events: none; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.results-count { margin: 0 0 13px; color: var(--rdx-text-strong); font-size: 14px; }
.results-count strong { font-size: 16px; }
.results-count span { color: var(--rdx-text-muted); }
.empty-state { padding: 24px; }
.plant-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; list-style: none; padding: 0; margin: 0; }
.plant-card { padding: 14px 16px 12px; overflow: hidden; }
.plant-head { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--rdx-neutral-soft); }
.provider-mark { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; background: var(--rdx-background); color: #148ac1; font-size: 11px; font-weight: 800; letter-spacing: -.04em; }
.provider-growatt { color: #62a818; font-size: 9px; }
.plant-title { min-width: 0; }
.plant-title h2 { margin: 0; overflow-wrap: anywhere; font-size: 16px; line-height: 1.3; }
.provider { display: block; margin-top: 3px; color: var(--rdx-text-muted); font-size: 11px; font-weight: 600; }
.state-badge { display: inline-flex; align-items: center; gap: 7px; align-self: start; margin-top: 1px; padding: 5px 11px; border-radius: 999px; white-space: nowrap; }
.state-badge .status-dot { width: 8px; height: 8px; }
.plant-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; padding: 12px 0; border-bottom: 1px solid var(--rdx-neutral-soft); }
.plant-metrics > div { display: grid; grid-template-columns: 25px minmax(0, 1fr); grid-template-rows: auto auto; min-width: 0; padding: 0 10px; border-right: 1px solid var(--rdx-neutral-soft); }
.plant-metrics > div:first-child { padding-left: 4px; }
.plant-metrics > div:last-child { padding-right: 0; border-right: 0; }
.metric-icon { grid-row: 1 / 3; align-self: center; color: #098a51; font-size: 23px; line-height: 1; }
.plant-metrics dt { color: var(--rdx-text-muted); font-size: 10px; line-height: 1.3; white-space: nowrap; }
.plant-metrics dd { margin: 3px 0 0; color: var(--rdx-text-strong); font-size: 13px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.plant-foot { display: grid; grid-template-columns: .8fr 1fr 1.35fr auto; align-items: center; gap: 0; padding-top: 10px; }
.foot-metric { display: grid; grid-template-columns: 24px minmax(0, 1fr); grid-template-rows: auto auto; min-width: 0; padding: 0 10px; border-right: 1px solid var(--rdx-neutral-soft); }
.foot-metric:first-child { padding-left: 4px; }
.foot-icon { grid-row: 1 / 3; align-self: center; color: var(--rdx-primary); font-size: 21px; }
.foot-metric > span:not(.foot-icon) { color: var(--rdx-text-muted); font-size: 10px; line-height: 1.3; }
.foot-metric strong { color: var(--rdx-text-strong); font-size: 11px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
.foot-metric small { grid-column: 2; color: var(--rdx-text-faint); font-size: 9px; }
.telemetry-fresh { color: var(--rdx-success) !important; }
.telemetry-stale { color: var(--rdx-warning) !important; }
.telemetry-no_data { color: var(--rdx-text-muted) !important; }
.detail-link { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 118px; min-height: 38px; margin-left: 12px; padding: 7px 13px; border-radius: var(--rdx-radius-sm); background: var(--rdx-primary-soft); color: var(--rdx-primary); font-size: 12px; font-weight: 700; white-space: nowrap; transition: background-color var(--rdx-transition), color var(--rdx-transition); }
.detail-link:hover { background: var(--rdx-primary); color: #fff; }
.pagination { margin-top: 20px; }
@media (max-width: 1199px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .search-filter { grid-column: 1 / -1; }
  .plant-grid { grid-template-columns: 1fr; }
}
@media (max-width: 767px) {
  .plants-header h1 { font-size: 28px; }
  .summary-grid { gap: 10px; }
  .summary-card { min-height: 96px; padding: 14px; gap: 12px; }
  .summary-icon { width: 40px; height: 40px; flex-basis: 40px; }
  .summary-card strong { font-size: 25px; }
  .filters { grid-template-columns: 1fr; }
  .search-filter { grid-column: auto; }
  .plant-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 12px; }
  .plant-metrics > div:nth-child(2) { border-right: 0; }
  .plant-metrics > div:nth-child(n + 3) { padding-top: 12px; border-top: 1px solid var(--rdx-neutral-soft); }
  .plant-foot { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 0; }
  .telemetry-metric { border-right: 0; }
  .reading-metric { padding-left: 4px; }
  .detail-link { align-self: stretch; margin-left: 10px; }
}
@media (max-width: 479px) {
  .summary-grid { grid-template-columns: 1fr; }
  .summary-card { min-height: 82px; }
  .plant-card { padding: 14px; }
  .plant-head { grid-template-columns: 44px minmax(0, 1fr); gap: 10px; }
  .provider-mark { width: 44px; height: 44px; }
  .state-badge { grid-column: 2; justify-self: start; }
  .plant-metrics > div { padding-inline: 6px; }
  .plant-metrics dt { white-space: normal; }
  .plant-foot { grid-template-columns: 1fr 1fr; }
  .reading-metric { grid-column: 1 / -1; padding-top: 10px; border-top: 1px solid var(--rdx-neutral-soft); border-right: 0; }
  .detail-link { grid-column: 1 / -1; width: 100%; margin: 0; }
}
</style>
