<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { apiFetch } from '../services/api.js';

const summary = ref(null);
const growattAlarms = ref(null);
const hyxiAlarms = ref(null);

const loading = ref(true);
const error = ref('');

const lastUpdatedAt = ref(null);
const refreshError = ref('');
const refreshInFlight = ref(false);

let refreshTimer = null;
const REFRESH_INTERVAL_MS = 60 * 1000;

const controller = new AbortController();

const formatter = new Intl.NumberFormat('es-BO', {
  maximumFractionDigits: 2,
});

const clockFormatter = new Intl.DateTimeFormat('es-BO', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const providerNames = {
  hyxi: 'HYXi',
  growatt: 'Growatt',
};

function available(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatValue(value) {
  return available(value)
    ? formatter.format(value)
    : '—';
}

function formatEnergy(value) {
  if (!available(value)) return '—';

  if (Math.abs(value) >= 1000) {
    return `${formatter.format(value / 1000)} MWh`;
  }

  return `${formatter.format(value)} kWh`;
}

function formatPower(value) {
  if (!available(value)) return '—';

  if (Math.abs(value) >= 1000) {
    return `${formatter.format(value / 1000)} kW`;
  }

  return `${formatter.format(value)} W`;
}

function providerLabel(provider) {
  return providerNames[provider]
    ?? provider
    ?? '—';
}

function formatClock(timestamp) {
  if (!timestamp) return '—';

  return clockFormatter.format(
    new Date(timestamp),
  );
}

const growattAlarmItems = computed(() => {
  const data = growattAlarms.value;

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.alarms)) return data.alarms;
  if (Array.isArray(data?.items)) return data.items;

  return [];
});

const hyxiAlarmItems = computed(() => {
  const data = hyxiAlarms.value;

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.alarms)) return data.alarms;
  if (Array.isArray(data?.items)) return data.items;

  return [];
});

const hyxiUnavailable = computed(() => {
  if (!hyxiAlarms.value) {
    return true;
  }

  return (
    hyxiAlarms.value.partial === true
    || (
      Number(hyxiAlarms.value.failed_plants) > 0
      && Number(hyxiAlarms.value.checked_plants) > 0
      && Number(hyxiAlarms.value.failed_plants)
        >= Number(hyxiAlarms.value.checked_plants)
    )
  );
});

const currentIncidents = computed(() => {
  return growattAlarmItems.value.length
    + hyxiAlarmItems.value.length;
});

const topMaxValue = computed(() => {
  const values = (summary.value?.top_plants ?? [])
    .map(plant => Number(plant.today_generation_kwh))
    .filter(Number.isFinite);

  return values.length ? Math.max(...values) : 0;
});

const topPlants = computed(() =>
  (summary.value?.top_plants ?? []).map(plant => ({
    ...plant,
    width: topMaxValue.value > 0
      ? `${Math.max(
        0,
        Math.min(
          100,
          Number(plant.today_generation_kwh) * 100
            / topMaxValue.value,
        ),
      )}%`
      : '0%',
  })),
);

// SVG geometry only: preserve source counts and leave missing data unpainted.
const plantStateRing = computed(() => {
  const values = [
    ['online', summary.value?.online_plants],
    ['offline', summary.value?.offline_plants],
    ['alarm', summary.value?.alarm_plants],
    ['unknown', summary.value?.unknown_plants],
  ];
  const total = summary.value?.total_plants;
  if (!available(total) || total <= 0) return [];
  const known = values.filter(([, value]) => available(value) && value >= 0);
  if (known.reduce((sum, [, value]) => sum + value, 0) > total) return [];
  let offset = 0;
  return known.map(([state, value]) => {
    const length = value / total * 100;
    const segment = { state, length, offset };
    offset += length;
    return segment;
  });
});

const providerCards = computed(() => {
  return (summary.value?.providers ?? []).map(
    provider => ({
      ...provider,
      label: providerLabel(provider.provider),
    }),
  );
});

/*
 * Carga inicial o refresco periódico de los datos del
 * dashboard usando solo la API RDX existente.
 *
 * Nunca se dispara sync de fabricantes y nunca se recarga
 * la página: se reemplazan los valores en memoria.
 *
 * El guard refreshInFlight evita requests simultáneos si
 * un refresco anterior sigue activo.
 */
async function fetchDashboard({ initial = false } = {}) {
  if (refreshInFlight.value) {
    return;
  }

  refreshInFlight.value = true;

  if (initial) {
    loading.value = true;
  }

  error.value = '';
  refreshError.value = '';

  try {
    const [
      summaryResult,
      growattResult,
      hyxiResult,
    ] = await Promise.allSettled([
      apiFetch('/dashboard/summary', {
        signal: controller.signal,
      }),

      apiFetch(
        '/integrations/growatt/alarms/current',
        {
          signal: controller.signal,
        },
      ),

      apiFetch(
        '/integrations/hyxi/alarms/recent',
        {
          signal: controller.signal,
        },
      ),
    ]);

    if (summaryResult.status !== 'fulfilled') {
      throw summaryResult.reason;
    }

    if (
      !summaryResult.value
      || typeof summaryResult.value !== 'object'
      || Array.isArray(summaryResult.value)
    ) {
      throw new Error('Respuesta inválida');
    }

    summary.value = summaryResult.value;
    lastUpdatedAt.value = Date.now();

    /*
     * Cada fuente se actualiza solo si respondió: así un
     * fallo parcial no borra los últimos datos válidos.
     */
    if (growattResult.status === 'fulfilled') {
      growattAlarms.value = growattResult.value;
    }

    if (hyxiResult.status === 'fulfilled') {
      hyxiAlarms.value = hyxiResult.value;
    }

    error.value = '';
    refreshError.value = '';
  } catch {
    if (!controller.signal.aborted) {
      if (initial) {
        error.value =
          'No se pudo cargar el resumen ejecutivo. '
          + 'Comprueba la conexión con el servidor '
          + 'y vuelve a cargar la página.';
      } else {
        refreshError.value =
          'No se pudo actualizar. Se conservan '
          + 'los últimos datos.';
      }
    }
  } finally {
    refreshInFlight.value = false;

    if (initial) {
      loading.value = false;
    }
  }
}

onMounted(() => {
  void fetchDashboard({ initial: true });

  refreshTimer = setInterval(() => {
    void fetchDashboard();
  }, REFRESH_INTERVAL_MS);
});

onUnmounted(() => {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  controller.abort();
});
</script>

<template>
  <div class="dashboard-view">
    <header class="page-header dashboard-header">
      <div>
        <h1>
          Dashboard
        </h1>

        <p class="header-description">
          Estado y producción del parque fotovoltaico.
        </p>
      </div>

      <div class="header-meta">
        <span
          v-if="summary && lastUpdatedAt"
          class="update-note"
        >
          Última actualización
          {{ formatClock(lastUpdatedAt) }}
        </span>

        <span
          v-if="refreshError"
          class="update-note update-error"
          role="status"
        >
          {{ refreshError }}
        </span>
      </div>
    </header>

    <div
      v-if="loading"
      class="card page-state"
      role="status"
      aria-live="polite"
    >
      Cargando resumen del parque…
    </div>

    <div
      v-else-if="error"
      class="card page-state error-state"
      role="alert"
    >
      <h2>
        No se pudo cargar el dashboard
      </h2>

      <p>
        {{ error }}
      </p>
    </div>

    <div
      v-else-if="summary"
      class="dashboard"
    >
      <!-- RESUMEN DEL PARQUE -->

      <section class="summary-section" aria-label="Indicadores principales">
        <div class="executive-kpis">
          <article class="executive-kpi">
            <span class="kpi-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21V11m0 4C5 16 3 11 3 5c6 0 9 3 9 8m0-3c0-5 4-7 9-7 0 6-3 9-9 9"/></svg></span>
            <div class="kpi-content">
              <p>
                Plantas
              </p>

              <strong>
                {{ formatValue(summary.total_plants) }}
              </strong>

              <small>
                instalaciones registradas
              </small>
            </div>
          </article>

          <article class="executive-kpi">
            <span class="kpi-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m13 2-8 12h6l-1 8 9-13h-6l1-7Z"/></svg></span>
            <div class="kpi-content">
              <p>
                Potencia actual
              </p>

              <strong>
                {{
                  formatPower(
                    summary.current_generation_power_w,
                  ).split(' ')[0]
                }}
                <em>{{ formatPower(summary.current_generation_power_w).split(' ')[1] }}</em>
              </strong>

              <small>
                solo telemetría vigente
              </small>
            </div>
          </article>

          <article class="executive-kpi featured-kpi">
            <span class="kpi-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 14h4v7H4zm6-6h4v13h-4zm6-5h4v18h-4"/></svg></span>
            <div class="kpi-content">
              <p>
                Energía hoy
              </p>

              <strong>
                {{
                  formatValue(
                    summary.today_generation_kwh,
                  )
                }}

                <em>
                  kWh
                </em>
              </strong>

              <small>
                producción registrada hoy
              </small>
            </div>
          </article>

          <article class="executive-kpi">
            <span class="kpi-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 10c0 4 18 4 18 0M3 15c0 4 18 4 18 0"/></svg></span>
            <div class="kpi-content">
              <p>Energía total</p>
              <strong>
                {{ formatEnergy(summary.total_generation_kwh).split(' ')[0] }}
                <em>{{ formatEnergy(summary.total_generation_kwh).split(' ')[1] }}</em>
              </strong>
              <small>histórico registrado · cobertura parcial</small>
            </div>
          </article>
        </div>
      </section>

      <!-- OPERACIÓN Y PRODUCCIÓN -->

      <section class="overview-grid">
        <article class="executive-panel production-panel">
          <header class="panel-header">
            <div>
              <h2>
                Producción de energía
              </h2>
            </div>

            <span class="production-current">
              {{ formatValue(summary.total_capacity_kwp) }} kWp
              <small>capacidad instalada</small>
            </span>
          </header>

          <dl class="production-list">
            <div class="production-main">
              <dt>
                Hoy
              </dt>

              <dd>
                <span>{{ formatEnergy(summary.today_generation_kwh).split(' ')[0] }}</span>
                <em>{{ formatEnergy(summary.today_generation_kwh).split(' ')[1] }}</em>
              </dd>
            </div>

            <div>
              <dt>
                Mes
              </dt>

              <dd>
                <span>{{ formatEnergy(summary.month_generation_kwh).split(' ')[0] }}</span>
                <em>{{ formatEnergy(summary.month_generation_kwh).split(' ')[1] }}</em>
              </dd>
            </div>

            <div>
              <dt>
                Año
              </dt>

              <dd>
                <span>{{ formatEnergy(summary.year_generation_kwh).split(' ')[0] }}</span>
                <em>{{ formatEnergy(summary.year_generation_kwh).split(' ')[1] }}</em>
              </dd>
            </div>

            <div>
              <dt>
                Histórico registrado
              </dt>

              <dd>
                <span>{{ formatEnergy(summary.total_generation_kwh).split(' ')[0] }}</span>
                <em>{{ formatEnergy(summary.total_generation_kwh).split(' ')[1] }}</em>
              </dd>
            </div>
          </dl>

          <div class="data-warning">
            <strong>
              Cobertura parcial de acumulados
            </strong>

            <span>
              Los acumulados mensual, anual e histórico
              todavía no cuentan con la misma cobertura
              de datos para HYXi y Growatt.
            </span>
          </div>
        </article>

        <article class="executive-panel operation-panel">
          <header class="panel-header">
            <div>
              <h2>
                Estado del parque
              </h2>
            </div>


          </header>

          <div class="park-overview">
            <div class="state-donut">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle class="ring-track" cx="60" cy="60" r="49" />
                <circle v-for="segment in plantStateRing" :key="segment.state"
                  cx="60" cy="60" r="49" pathLength="100"
                  :class="'ring-' + segment.state"
                  :stroke-dasharray="segment.length + ' ' + (100 - segment.length)"
                  :stroke-dashoffset="-segment.offset" />
              </svg>
              <div class="donut-total"><strong>{{ formatValue(summary.total_plants) }}</strong><span>plantas</span></div>
            </div>
          <div class="state-group plant-legend">
            <p class="group-label">
              Plantas
            </p>

            <div class="status-list">
              <div class="status-row">
                <span
                  class="status-indicator status-online"
                ></span>

                <div>
                  <strong>
                    {{
                      formatValue(summary.online_plants)
                    }}
                  </strong>

                  <span>
                    En línea
                  </span>
                </div>
              </div>

              <div class="status-row">
                <span
                  class="status-indicator status-offline"
                ></span>

                <div>
                  <strong>
                    {{
                      formatValue(summary.offline_plants)
                    }}
                  </strong>

                  <span>
                    Sin conexión
                  </span>
                </div>
              </div>

              <div class="status-row">
                <span
                  class="status-indicator status-alarm"
                ></span>

                <div>
                  <strong>
                    {{
                      formatValue(summary.alarm_plants)
                    }}
                  </strong>

                  <span>
                    Con alarma
                  </span>
                </div>
              </div>

              <div
                v-if="
                  Number(summary.unknown_plants) > 0
                "
                class="status-row"
              >
                <span
                  class="status-indicator status-unknown"
                ></span>

                <div>
                  <strong>
                    {{
                      formatValue(summary.unknown_plants)
                    }}
                  </strong>

                  <span>
                    Desconocido
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p class="context-note">
            El estado de planta corresponde a la condición
            reportada por cada plataforma; la telemetría
            refleja la vigencia de los últimos datos.
          </p>
          </div>

          <div class="state-group telemetry-group">
            <p class="group-label">
              Telemetría
            </p>

            <div class="status-list telemetry-list">
              <div class="status-row">
                <span class="telemetry-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r="1"/></svg></span>

                <div>
                  <strong>
                    {{
                      formatValue(summary.telemetry_current)
                    }}
                  </strong>

                  <span>
                    Telemetría actual
                  </span>
                </div>
              </div>

              <div class="status-row">
                <span class="telemetry-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg></span>

                <div>
                  <strong>
                    {{
                      formatValue(summary.telemetry_stale)
                    }}
                  </strong>

                  <span>
                    Atrasada
                  </span>
                </div>
              </div>

              <div class="status-row">
                <span class="telemetry-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></span>

                <div>
                  <strong>
                    {{
                      formatValue(summary.telemetry_no_data)
                    }}
                  </strong>

                  <span>
                    Sin datos
                  </span>
                </div>
              </div>
            </div>
          </div>


        </article>
      </section>

      <!-- PRODUCCIÓN POR PLANTA -->

      <section class="ranking-section">
        <div class="section-heading">
          <div>
            <h2>
              Producción por planta
            </h2>
          </div>

          <RouterLink
            class="text-link"
            to="/plants"
          >
            Ver todas las plantas →
          </RouterLink>
        </div>

        <div
          v-if="topPlants.length"
          class="top-plants-card"
        >
          <ol class="top-plants-list">
            <li
              v-for="(plant, index) in topPlants.slice(0, 5)"
              :key="plant.plant_id"
              class="top-plant"
            >
              <span class="top-rank">
                {{ index + 1 }}
              </span>

              <span
                class="provider-logo"
                :class="
                  `provider-${plant.provider}`
                "
              >
                {{
                  plant.provider === 'hyxi'
                    ? 'HX'
                    : 'GW'
                }}
              </span>

              <div class="top-plant-info">
                <strong :title="plant.name">
                  {{ plant.name }}
                </strong>
              </div>

              <div class="top-bar">
                <span
                  class="top-bar-fill"
                  :style="{ width: plant.width }"
                ></span>
              </div>

              <div class="top-energy">
                <strong>
                  {{
                    formatEnergy(
                      plant.today_generation_kwh,
                    )
                  }}
                </strong>

                <small>
                  hoy
                </small>
              </div>
            </li>
          </ol>
        </div>

        <div
          v-else
          class="card page-state top-plants-empty"
          role="status"
        >
          Aún no hay producción registrada hoy por planta
          para armar el ranking.
        </div>
      </section>

      <!-- INCIDENCIAS -->

      <section class="incidents-section">
        <div class="section-heading">
          <div>
            <h2>
              Incidencias
            </h2>
          </div>

          <p>
            Estado de eventos disponible desde
            las plataformas integradas.
          </p>
        </div>

        <div class="incidents-grid">
          <!-- GROWATT -->

          <article class="incident-card">
            <header>
              <div>
                <span
                  class="provider-logo provider-growatt"
                >
                  GW
                </span>

                <div>
                  <h3>
                    Growatt
                  </h3>

                  <p>
                    Diagnóstico actual
                  </p>
                </div>
              </div>

              <strong>
                {{ growattAlarmItems.length }}
              </strong>
            </header>

            <div
              v-if="growattAlarms === null"
              class="incident-state unavailable"
            >
              <span class="incident-icon">
                !
              </span>

              <div>
                <strong>
                  Consulta no disponible
                </strong>

                <p>
                  No fue posible consultar el diagnóstico
                  actual de Growatt.
                </p>
              </div>
            </div>

            <div
              v-else-if="
                growattAlarmItems.length === 0
              "
              class="incident-state ok"
            >
              <span class="incident-icon">
                ✓
              </span>

              <div>
                <strong>
                  Sin incidencias actuales
                </strong>

                <p>
                  No se detectaron fallas o advertencias
                  actuales en los dispositivos Growatt.
                </p>
              </div>
            </div>

            <div
              v-else
              class="incident-state warning"
            >
              <span class="incident-icon">
                !
              </span>

              <div>
                <strong>
                  {{ growattAlarmItems.length }}
                  incidencia(s) actual(es)
                </strong>

                <p>
                  Consulta el módulo de Alarmas
                  para revisar el detalle.
                </p>
              </div>
            </div>
          </article>

          <!-- HYXI -->

          <article class="incident-card">
            <header>
              <div>
                <span
                  class="provider-logo provider-hyxi"
                >
                  HX
                </span>

                <div>
                  <h3>
                    HYXi
                  </h3>

                  <p>
                    Eventos de alarma
                  </p>
                </div>
              </div>

              <strong
                v-if="!hyxiUnavailable"
              >
                {{ hyxiAlarmItems.length }}
              </strong>

              <strong
                v-else
                class="unavailable-symbol"
              >
                —
              </strong>
            </header>

            <div
              v-if="hyxiUnavailable"
              class="incident-state unavailable"
            >
              <span class="incident-icon">
                !
              </span>

              <div>
                <strong>
                  Consulta temporalmente no disponible
                </strong>

                <p>
                  Los datos de las plantas HYXi continúan
                  disponibles, pero actualmente no es
                  posible consultar sus eventos de alarma.
                </p>
              </div>
            </div>

            <div
              v-else-if="
                hyxiAlarmItems.length === 0
              "
              class="incident-state ok"
            >
              <span class="incident-icon">
                ✓
              </span>

              <div>
                <strong>
                  Sin alarmas reportadas
                </strong>

                <p>
                  La consulta de eventos HYXi se completó
                  correctamente.
                </p>
              </div>
            </div>

            <div
              v-else
              class="incident-state warning"
            >
              <span class="incident-icon">
                !
              </span>

              <div>
                <strong>
                  {{ hyxiAlarmItems.length }}
                  alarma(s)
                </strong>

                <p>
                  Consulta el módulo de Alarmas
                  para revisar el detalle.
                </p>
              </div>
            </div>
          </article>
        </div>

        <div class="incident-summary">
          <span>
            Incidencias visibles actualmente
          </span>

          <strong>
            {{
              hyxiUnavailable
                ? `${growattAlarmItems.length} + HYXi no disponible`
                : currentIncidents
            }}
          </strong>
        </div>
      </section>

      <!-- PROVEEDORES -->

      <section class="providers-section">
        <div class="section-heading">
          <div>
            <h2>
              Plataformas conectadas
            </h2>
          </div>

          <p>
            Estado operativo e inventario
            por fabricante.
          </p>
        </div>

        <div class="providers-grid">
          <article
            v-for="provider in providerCards"
            :key="provider.provider"
            class="provider-card"
          >
            <header class="provider-card-header">
              <div class="provider-title">
                <span
                  class="provider-logo"
                  :class="
                    `provider-${provider.provider}`
                  "
                >
                  {{
                    provider.provider === 'hyxi'
                      ? 'HX'
                      : 'GW'
                  }}
                </span>

                <div>
                  <h3>
                    {{ provider.label }}
                  </h3>

                  <p>
                    {{
                      formatValue(
                        provider.total_capacity_kwp,
                      )
                    }}
                    kWp instalados
                  </p>
                </div>
              </div>

              <strong class="provider-count">
                {{
                  formatValue(
                    provider.total_plants,
                  )
                }}

                <small>
                  plantas
                </small>
              </strong>
            </header>

            <div class="provider-groups">
              <div class="provider-group">
                <p class="group-label">
                  Plantas
                </p>

                <div class="provider-chips">
                  <span class="provider-chip">
                    <span
                      class="mini-dot dot-online"
                    ></span>

                    <strong>
                      {{
                        formatValue(
                          provider.online_plants,
                        )
                      }}
                    </strong>

                    <small>
                      En línea
                    </small>
                  </span>

                  <span class="provider-chip">
                    <span
                      class="mini-dot dot-offline"
                    ></span>

                    <strong>
                      {{
                        formatValue(
                          provider.offline_plants,
                        )
                      }}
                    </strong>

                    <small>
                      Sin conexión
                    </small>
                  </span>

                  <span class="provider-chip">
                    <span
                      class="mini-dot dot-alarm"
                    ></span>

                    <strong>
                      {{
                        formatValue(
                          provider.alarm_plants,
                        )
                      }}
                    </strong>

                    <small>
                      Alarma
                    </small>
                  </span>

                  <span
                    v-if="
                      Number(
                        provider.unknown_plants,
                      ) > 0
                    "
                    class="provider-chip"
                  >
                    <span
                      class="mini-dot dot-unknown"
                    ></span>

                    <strong>
                      {{
                        formatValue(
                          provider.unknown_plants,
                        )
                      }}
                    </strong>

                    <small>
                      Desconocido
                    </small>
                  </span>
                </div>
              </div>

              <div class="provider-group">
                <p class="group-label">
                  Telemetría
                </p>

                <div class="provider-chips">
                  <span class="provider-chip">
                    <span
                      class="mini-dot dot-online"
                    ></span>

                    <strong>
                      {{
                        formatValue(
                          provider.telemetry_current,
                        )
                      }}
                    </strong>

                    <small>
                      Actual
                    </small>
                  </span>

                  <span class="provider-chip">
                    <span
                      class="mini-dot dot-stale"
                    ></span>

                    <strong>
                      {{
                        formatValue(
                          provider.telemetry_stale,
                        )
                      }}
                    </strong>

                    <small>
                      Atrasada
                    </small>
                  </span>

                  <span class="provider-chip">
                    <span
                      class="mini-dot dot-unknown"
                    ></span>

                    <strong>
                      {{
                        formatValue(
                          provider.telemetry_no_data,
                        )
                      }}
                    </strong>

                    <small>
                      Sin datos
                    </small>
                  </span>
                </div>
              </div>
            </div>

            <div class="provider-footer">
              <span>
                {{
                  formatValue(
                    provider.total_devices,
                  )
                }}
                dispositivos registrados
              </span>
            </div>
          </article>
        </div>
      </section>

    </div>
  </div>
</template>

<style scoped>
:global(.app-shell:has(.dashboard-view) .main-content) { max-width: 1920px; padding: 18px 22px; }
:global(.app-shell:has(.dashboard-view) .app-topbar) { display: none; }
.dashboard-view { width: 100%; min-width: 0; line-height: 1.5; }
.dashboard-header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 22px; }
.dashboard-header h1 { margin: 0 0 4px; font-size: 32px; line-height: 1.2; }
.header-description { margin: 0; font-size: 15px; line-height: 1.5; }
.header-meta { display: grid; gap: 6px; text-align: right; color: var(--rdx-text-muted); font-size: 12px; }
.update-error { color: var(--rdx-danger); max-width: 300px; }
.dashboard { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 18px; }
.dashboard > section { min-width: 0; }
.summary-section, .overview-grid, .providers-section { grid-column: 1 / -1; }
.executive-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.executive-kpi, .executive-panel, .ranking-section, .incidents-section, .providers-section { background: var(--rdx-surface); border: 1px solid var(--rdx-neutral-soft); border-radius: var(--rdx-radius-lg); box-shadow: 0 2px 6px rgb(23 63 51 / 4%), 0 8px 24px rgb(23 63 51 / 2%); }
.executive-kpi { display: flex; align-items: flex-start; gap: 16px; min-width: 0; padding: 22px 20px; }
.kpi-icon { flex: 0 0 48px; height: 48px; display: grid; place-items: center; border-radius: 50%; background: var(--rdx-background); color: var(--rdx-primary); }
.kpi-icon svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.kpi-content { min-width: 0; }
.executive-kpi p { margin: 0 0 8px; font-size: 14px; font-weight: 500; }
.executive-kpi strong { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; font-size: 34px; line-height: 1.15; letter-spacing: -.035em; font-weight: 600; color: var(--rdx-text-strong); overflow-wrap: anywhere; }
.executive-kpi em { font-size: 15px; white-space: nowrap; font-style: normal; font-weight: 600; letter-spacing: normal; }
.executive-kpi small { display: block; margin-top: 10px; font-size: 12px; line-height: 1.5; color: var(--rdx-text-muted); }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 18px; }
.executive-panel, .ranking-section, .incidents-section, .providers-section { min-width: 0; padding: 22px; }
.section-heading, .panel-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 18px; }
.section-heading h2, .panel-header h2 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -.025em; }
.section-heading > p { margin: 0; font-size: 12px; color: var(--rdx-text-muted); }
.production-current { font-size: 16px; font-weight: 600; text-align: right; color: var(--rdx-text-strong); }
.production-current small { display: block; font-size: 12px; font-weight: 400; color: var(--rdx-text-muted); }
.production-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px 20px; margin: 8px 0 24px; }
.production-list .production-main { grid-column: 1 / -1; padding: 0 0 22px; border-bottom: 1px solid var(--rdx-border); }
.production-list > div:not(.production-main) + div { border-left: 1px solid var(--rdx-neutral-soft); padding-left: 20px; }
.production-list > div { min-width: 0; }
.production-list dt { margin-bottom: 8px; font-size: 14px; color: var(--rdx-text-muted); }
.production-list dd { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; margin: 0; font-size: 23px; line-height: 1.2; font-weight: 600; color: var(--rdx-text-strong); overflow-wrap: anywhere; }
.production-list dd em { font-size: 13px; font-style: normal; font-weight: 500; color: var(--rdx-text-muted); letter-spacing: normal; }
.production-list .production-main dd em { font-size: 16px; }
.production-list .production-main dd { color: var(--rdx-primary); font-size: 40px; letter-spacing: -.035em; line-height: 1.15; }
.data-warning { display: grid; gap: 4px; padding: 12px 14px; background: var(--rdx-background); border-radius: var(--rdx-radius-sm); }
.data-warning strong { color: var(--rdx-text); font-size: 12px; font-weight: 600; }
.data-warning span { color: var(--rdx-text-muted); font-size: 12px; line-height: 1.5; }
.park-overview { display: grid; grid-template-columns: 164px minmax(0, 1fr); align-items: center; gap: 24px; margin: 14px 0; }
.state-donut { position: relative; width: 164px; height: 164px; }
.state-donut svg { display: block; width: 100%; height: 100%; transform: rotate(-90deg); }
.state-donut circle { fill: none; stroke-width: 19; }
.ring-track { stroke: var(--rdx-neutral-soft); }
.ring-online { stroke: var(--rdx-success); }
.ring-offline { stroke: var(--rdx-warning); }
.ring-alarm { stroke: var(--rdx-danger); }
.ring-unknown { stroke: var(--rdx-neutral); }
.donut-total { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; }
.donut-total strong { font-size: 34px; font-weight: 600; color: var(--rdx-text-strong); }
.donut-total span { font-size: 13px; color: var(--rdx-text-muted); }
.plant-legend > .group-label { display: none; }
.group-label { font-size: 12px; font-weight: 500; color: var(--rdx-text-muted); margin: 0 0 8px; }
.status-list { display: grid; gap: 18px; }
.status-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
.status-row div { display: flex; flex: 1; align-items: center; justify-content: space-between; gap: 12px; }
.status-row strong { order: 2; font-size: 18px; font-weight: 600; color: var(--rdx-text-strong); }
.status-row span:last-child { font-size: 14px; color: var(--rdx-text); }
.status-indicator, .mini-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; }
.status-online, .dot-online { background: var(--rdx-success); }
.status-offline, .status-stale, .dot-offline, .dot-stale { background: var(--rdx-warning); }
.status-alarm, .dot-alarm { background: var(--rdx-danger); }
.status-unknown, .dot-unknown { background: var(--rdx-neutral); }
.telemetry-group { padding-top: 22px; margin-top: 20px; border-top: 1px solid var(--rdx-neutral-soft); }
.telemetry-list { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.telemetry-list .status-row { align-items: center; gap: 10px; }
.telemetry-list .status-row div { flex-direction: column; align-items: flex-start; gap: 0; }
.telemetry-list .status-row strong { order: 0; font-size: 24px; line-height: 1.3; }
.telemetry-list .status-row span:last-child { font-size: 12px; color: var(--rdx-text-muted); }
.context-note { margin: 0; padding: 12px; border-radius: var(--rdx-radius-sm); background: var(--rdx-background); font-size: 12px; line-height: 1.5; color: var(--rdx-text-muted); }
.text-link { color: var(--rdx-primary); font-size: 13px; font-weight: 500; transition: color var(--rdx-transition); text-underline-offset: 4px; }
.text-link:hover { color: var(--rdx-primary-hover); text-decoration: underline; }
.top-plants-list { margin: 0; padding: 0; list-style: none; }
.top-plant { display: grid; grid-template-columns: 20px 38px minmax(0, 1.2fr) minmax(65px, 1fr) auto; gap: 10px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--rdx-neutral-soft); }
.top-plant:last-child { border: 0; }
.top-rank { font-size: 12px; color: var(--rdx-text-muted); text-align: center; }
.provider-logo { display: grid; place-items: center; width: 48px; height: 48px; flex: 0 0 48px; border-radius: 50%; background: var(--rdx-background); font-size: 12px; font-weight: 600; color: var(--rdx-primary); }
.top-plant .provider-logo { width: 38px; height: 26px; border-radius: 5px; font-size: 12px; }
.top-plant-info { min-width: 0; }
.top-plant-info strong { display: block; font-size: 14px; font-weight: 500; color: var(--rdx-text-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.top-bar { height: 10px; border-radius: 8px; overflow: hidden; background: var(--rdx-neutral-soft); }
.top-bar-fill { display: block; height: 100%; border-radius: inherit; background: var(--rdx-primary); }
.top-energy { display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; text-align: right; }
.top-energy strong { color: var(--rdx-text-strong); font-size: 14px; font-weight: 600; }
.top-energy small { font-size: 12px; color: var(--rdx-text-muted); }
.top-plants-empty { border: 0; box-shadow: none; padding: 20px 0; font-size: 13px; }
.incident-card { position: relative; padding: 10px 38px 10px 0; border-bottom: 1px solid var(--rdx-neutral-soft); }
.incident-card:first-child { padding-top: 0; }
.incident-card:last-child { border: 0; }
.incident-card header, .incident-card header > div { display: flex; align-items: center; gap: 10px; }
.incident-card header > strong { position: absolute; right: 0; top: 16px; font-size: 24px; font-weight: 600; color: var(--rdx-text-strong); }
.incident-card:first-child header > strong { top: 0; }
.incident-card h3 { margin: 0; font-size: 15px; font-weight: 600; }
.incident-card header p { margin: 0; font-size: 12px; color: var(--rdx-text-muted); }
.incident-state { display: flex; gap: 10px; margin-top: 10px; font-size: 14px; }
.incident-state.ok { color: var(--rdx-success); }
.incident-state.warning { color: var(--rdx-warning); }
.incident-state.unavailable { color: var(--rdx-text-muted); }
.incident-icon { display: grid; place-items: center; width: 20px; height: 20px; flex: 0 0 20px; border-radius: 50%; background: var(--rdx-neutral-soft); font-size: 12px; }
.ok .incident-icon { background: var(--rdx-success-soft); }
.warning .incident-icon { background: var(--rdx-warning-soft); }
.incident-state strong { font-weight: 500; }
.incident-state p { margin: 5px 0 0; font-size: 13px; line-height: 1.5; }
.incident-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; margin-top: 8px; border-radius: var(--rdx-radius-sm); background: var(--rdx-background); color: var(--rdx-text-muted); font-size: 12px; }
.incident-summary strong { font-weight: 600; }
.providers-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.provider-card { min-width: 0; padding: 20px; border: 1px solid var(--rdx-neutral-soft); border-radius: var(--rdx-radius-md); }
.provider-card-header, .provider-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.provider-title { justify-content: flex-start; }
.provider-title h3 { margin: 0; font-size: 16px; font-weight: 600; }
.provider-title p { margin: 4px 0 0; color: var(--rdx-text-muted); font-size: 13px; }
.provider-count { font-size: 30px; font-weight: 600; line-height: 1.2; text-align: right; color: var(--rdx-text-strong); }
.provider-count small { display: block; color: var(--rdx-text-muted); font-size: 12px; font-weight: 400; }
.provider-groups { display: grid; gap: 12px; margin-top: 20px; }
.provider-group { display: flex; flex-wrap: wrap; gap: 6px 12px; }
.provider-group .group-label { margin: 0; min-width: 66px; }
.provider-chips { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.provider-chip { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.provider-chip strong { color: var(--rdx-text-strong); font-weight: 500; }
.provider-chip small { font-size: 13px; color: var(--rdx-text-muted); }
.provider-footer { margin-top: 14px; font-size: 12px; color: var(--rdx-text-muted); }
.page-state { color: var(--rdx-text-muted); }
.error-state h2 { margin-top: 0; font-size: 18px; }
.error-state { border-color: var(--rdx-danger-soft); }
.telemetry-group > .group-label { display: none; }
.telemetry-icon { display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px; border-radius: 50%; background: var(--rdx-background); color: var(--rdx-primary); }
.telemetry-icon svg { width: 23px; height: 23px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.park-overview .context-note { grid-column: 1 / -1; }
@media (min-width: 1200px) {
  .top-plant { min-height: 58px; }
  .incident-card { display: grid; grid-template-columns: 150px minmax(0, 1fr); align-items: center; column-gap: 18px; padding-block: 20px; }
  .incident-state { margin-top: 0; }
  .park-overview { grid-template-columns: 164px minmax(0, 1fr); gap: 24px; }
  .park-overview .context-note { grid-column: 1 / -1; }
  .telemetry-list .status-row span:last-child { font-size: 12px; }
  .production-panel { display: flex; flex-direction: column; }
  .production-list { flex: 1; align-content: center; }
  .executive-kpi { min-height: 144px; }

}
@media (min-width: 1600px) {
  .executive-kpi { padding: 24px; }
  .park-overview { grid-template-columns: 164px minmax(0, 1fr) minmax(160px, .8fr); gap: 24px; }
  .park-overview .context-note { grid-column: auto; }
}
@media (min-width: 1200px) and (max-width: 1399px) {
  .executive-kpi { padding: 20px 16px; gap: 10px; }
  .executive-kpi strong { font-size: 32px; }
  .kpi-icon { flex-basis: 40px; height: 40px; }
  .kpi-icon svg { width: 25px; height: 25px; }
  .park-overview { grid-template-columns: 148px minmax(0, 1fr); }
  .state-donut { width: 148px; height: 148px; }
  .park-overview .context-note { grid-column: 1 / -1; padding: 8px 10px; }
  .telemetry-icon { width: 38px; height: 38px; flex-basis: 38px; }
}
@media (max-width: 1199px) {
  .executive-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dashboard, .overview-grid { grid-template-columns: minmax(0, 1fr); }
  .park-overview { grid-template-columns: 148px minmax(0, 1fr); }
}
@media (min-width: 768px) and (max-width: 1000px) {
  .executive-kpi { flex-direction: column; gap: 12px; }
}
@media (max-width: 1399px) {
  .production-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .production-list > div:last-child { grid-column: 1 / -1; }
  .production-list > div:not(.production-main) + div { border-left: 0; padding-left: 0; }
  .production-list > div:last-child { border-top: 1px solid var(--rdx-neutral-soft); padding-top: 16px; }
}
@media (max-width: 767px) {
  :global(.app-shell:has(.dashboard-view) .main-content) { padding: 20px 16px; }
  .executive-kpis, .providers-grid { grid-template-columns: minmax(0, 1fr); }
  .dashboard-header { align-items: flex-start; flex-direction: column; gap: 12px; }
  .header-meta { text-align: left; }
  .executive-kpi { padding: 18px; }
  .executive-panel, .ranking-section, .incidents-section, .providers-section { padding: 16px; }
  .park-overview { grid-template-columns: 116px minmax(0, 1fr); gap: 16px; }
  .state-donut { width: 116px; height: 116px; }
  .status-row div { gap: 6px; }
  .status-row span:last-child { font-size: 12px; }
  .production-list { gap: 20px 12px; }
  .top-plant { grid-template-columns: 16px 30px minmax(0, 1fr) auto; gap: 4px 8px; }
  .top-energy { grid-column: 4; grid-row: 1; }
  .top-plant .provider-logo { width: 30px; }
  .production-list .production-main dd { font-size: 34px; }
  .production-list dd { font-size: 21px; }
  .top-energy { flex-direction: column; align-items: flex-end; gap: 0; }
  .top-plant-info strong { white-space: normal; overflow-wrap: anywhere; }
  .top-bar { grid-column: 3 / -1; grid-row: 2; height: 6px; }
  .provider-group { display: grid; }
  .telemetry-icon { width: 28px; height: 28px; flex-basis: 28px; }
  .telemetry-list { gap: 8px; }
  .telemetry-list .status-row { gap: 6px; }
}
</style>
