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
        4,
        Math.min(
          100,
          Number(plant.today_generation_kwh) * 100
            / topMaxValue.value,
        ),
      )}%`
      : '4%',
  })),
);

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
    <header class="dashboard-header">
      <div>
        <p class="eyebrow">
          RDX Solar Monitor
        </p>

        <h1>
          Vista ejecutiva
        </h1>

        <p class="header-description">
          Supervisión unificada del parque fotovoltaico
          administrado por RDX Technology.
        </p>
      </div>

      <div class="header-meta">
        <span>
          Monitoreo multi-marca
        </span>

        <strong>
          HYXi + Growatt
        </strong>

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
      Cargando vista ejecutiva…
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

    <main
      v-else-if="summary"
      class="dashboard"
    >
      <!-- RESUMEN DEL PARQUE -->

      <section>
        <div class="section-heading">
          <div>
            <p class="section-kicker">
              Portafolio
            </p>

            <h2>
              Resumen del parque
            </h2>
          </div>

          <p>
            Indicadores consolidados de las instalaciones
            fotovoltaicas registradas.
          </p>
        </div>

        <div class="executive-kpis">
          <article class="executive-kpi">
            <span class="kpi-icon">
              01
            </span>

            <div>
              <p>
                Plantas
              </p>

              <strong>
                {{ formatValue(summary.total_plants) }}
              </strong>

              <small>
                instalaciones activas
              </small>
            </div>
          </article>

          <article class="executive-kpi">
            <span class="kpi-icon">
              02
            </span>

            <div>
              <p>
                Capacidad instalada
              </p>

              <strong>
                {{
                  formatValue(
                    summary.total_capacity_kwp,
                  )
                }}

                <em>
                  kWp
                </em>
              </strong>

              <small>
                potencia fotovoltaica instalada
              </small>
            </div>
          </article>

          <article class="executive-kpi featured-kpi">
            <span class="kpi-icon">
              03
            </span>

            <div>
              <p>
                Generación de hoy
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
            <span class="kpi-icon">
              04
            </span>

            <div>
              <p>
                Generación actual
              </p>

              <strong>
                {{
                  formatPower(
                    summary.current_generation_power_w,
                  )
                }}
              </strong>

              <small>
                solo telemetría vigente
              </small>
            </div>
          </article>
        </div>
      </section>

      <!-- OPERACIÓN Y PRODUCCIÓN -->

      <section class="overview-grid">
        <article class="executive-panel">
          <header class="panel-header">
            <div>
              <p class="section-kicker">
                Operación
              </p>

              <h2>
                Estado del parque
              </h2>
            </div>

            <span class="panel-total">
              {{ formatValue(summary.total_plants) }}
              plantas
            </span>
          </header>

          <div class="state-group">
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

          <div class="state-group">
            <p class="group-label">
              Telemetría
            </p>

            <div class="status-list telemetry-list">
              <div class="status-row">
                <span
                  class="status-indicator status-online"
                ></span>

                <div>
                  <strong>
                    {{
                      formatValue(summary.telemetry_current)
                    }}
                  </strong>

                  <span>
                    Actual
                  </span>
                </div>
              </div>

              <div class="status-row">
                <span
                  class="status-indicator status-stale"
                ></span>

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
                <span
                  class="status-indicator status-unknown"
                ></span>

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

          <p class="context-note">
            El estado de planta corresponde a la condición
            reportada por cada plataforma; la telemetría
            refleja la vigencia de los últimos datos.
          </p>
        </article>

        <article class="executive-panel">
          <header class="panel-header">
            <div>
              <p class="section-kicker">
                Energía
              </p>

              <h2>
                Producción acumulada
              </h2>
            </div>

            <span class="production-current">
              {{
                formatPower(
                  summary.current_generation_power_w,
                )
              }}
            </span>
          </header>

          <dl class="production-list">
            <div class="production-main">
              <dt>
                Hoy
              </dt>

              <dd>
                {{
                  formatEnergy(
                    summary.today_generation_kwh,
                  )
                }}
              </dd>
            </div>

            <div>
              <dt>
                Mes
              </dt>

              <dd>
                {{
                  formatEnergy(
                    summary.month_generation_kwh,
                  )
                }}
              </dd>
            </div>

            <div>
              <dt>
                Año
              </dt>

              <dd>
                {{
                  formatEnergy(
                    summary.year_generation_kwh,
                  )
                }}
              </dd>
            </div>

            <div>
              <dt>
                Histórico registrado
              </dt>

              <dd>
                {{
                  formatEnergy(
                    summary.total_generation_kwh,
                  )
                }}
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
      </section>

      <!-- PRODUCCIÓN POR PLANTA -->

      <section>
        <div class="section-heading">
          <div>
            <p class="section-kicker">
              Desempeño
            </p>

            <h2>
              Producción por planta
            </h2>
          </div>

          <RouterLink
            class="text-link"
            to="/plants"
          >
            Ver todas las plantas
          </RouterLink>
        </div>

        <div
          v-if="topPlants.length"
          class="top-plants-card"
        >
          <ol class="top-plants-list">
            <li
              v-for="(plant, index) in topPlants"
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
                <strong>
                  {{ plant.name }}
                </strong>

                <span>
                  {{ providerLabel(plant.provider) }}
                </span>
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

      <!-- PROVEEDORES -->

      <section>
        <div class="section-heading">
          <div>
            <p class="section-kicker">
              Integraciones
            </p>

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

      <!-- INCIDENCIAS -->

      <section>
        <div class="section-heading">
          <div>
            <p class="section-kicker">
              Supervisión
            </p>

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
    </main>
  </div>
</template>

<style scoped>
.dashboard-view {
  width: 100%;
  min-width: 0;
}

:global(.main-content:has(.dashboard-view)) {
  max-width: none;
  min-width: 0;
}

/* HEADER */

.dashboard-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 32px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--rdx-border);
}

.eyebrow,
.section-kicker {
  margin: 0;
  color: var(--rdx-accent);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.dashboard-header h1 {
  margin: 4px 0 8px;
  color: var(--rdx-text-strong);
  font-size: clamp(32px, 4vw, 46px);
  letter-spacing: -.045em;
}

.header-description {
  max-width: 680px;
  margin: 0;
  color: var(--rdx-text-muted);
  font-size: 15px;
}

.header-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.header-meta span {
  color: var(--rdx-text-faint);
  font-size: 11px;
}

.header-meta strong {
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.update-note {
  font-size: 10px;
  color: var(--rdx-text-faint);
}

.update-note.update-error {
  color: var(--rdx-danger);
}

/* GENERAL */

.dashboard {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 42px;
}

.page-state {
  padding: 28px;
}

.error-state {
  border-color: var(--rdx-danger-soft);
}

.error-state h2 {
  margin-top: 0;
}

.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
}

.section-heading h2,
.panel-header h2 {
  margin: 2px 0 0;
  color: var(--rdx-text-strong);
  font-size: 23px;
  letter-spacing: -.025em;
}

.section-heading > p {
  max-width: 470px;
  margin: 0;
  color: var(--rdx-text-muted);
  font-size: 13px;
  text-align: right;
}

/* KPIs */

.executive-kpis {
  display: grid;
  grid-template-columns:
    repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.executive-kpi {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
  min-height: 148px;
  padding: 24px;
  border: 1px solid var(--rdx-border);
  border-radius: 15px;
  background: var(--rdx-surface);
  box-shadow:
    0 6px 22px rgb(23 63 51 / 5%);
}

.executive-kpi.featured-kpi {
  border-color: var(--rdx-success-soft);
  background:
    linear-gradient(
      145deg,
      var(--rdx-success-soft),
      var(--rdx-surface)
    );
}

.kpi-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border-radius: 9px;
  background: var(--rdx-primary-soft);
  color: var(--rdx-accent);
  font-size: 10px;
  font-weight: 800;
}

.executive-kpi p {
  margin: 0 0 10px;
  color: var(--rdx-text-muted);
  font-size: 13px;
  font-weight: 650;
}

.executive-kpi strong {
  display: block;
  color: var(--rdx-text-strong);
  font-size: clamp(28px, 3vw, 40px);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.executive-kpi strong em {
  color: var(--rdx-text-muted);
  font-size: 13px;
  font-style: normal;
  font-weight: 600;
}

.executive-kpi small {
  display: block;
  margin-top: 11px;
  color: var(--rdx-text-faint);
  font-size: 11px;
}

/* ESTADO + PRODUCCIÓN */

.overview-grid {
  display: grid;
  grid-template-columns:
    minmax(0, 1fr)
    minmax(0, 1fr);
  gap: 18px;
}

.executive-panel {
  min-width: 0;
  padding: 27px;
  border: 1px solid var(--rdx-border);
  border-radius: 15px;
  background: var(--rdx-surface);
  box-shadow:
    0 5px 20px rgb(23 63 51 / 4%);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--rdx-border);
}

.panel-total,
.production-current {
  color: var(--rdx-text-muted);
  font-size: 12px;
  font-weight: 650;
}

.state-group + .state-group {
  margin-top: 4px;
}

.group-label {
  margin: 0 0 10px;
  color: var(--rdx-text-faint);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.status-list {
  display: grid;
  grid-template-columns:
    repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.state-group + .state-group .status-list {
  padding-top: 20px;
  border-top: 1px solid var(--rdx-border);
}

.status-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-indicator {
  width: 10px;
  height: 38px;
  flex: 0 0 10px;
  border-radius: 6px;
}

.status-online {
  background: var(--rdx-success);
}

.status-offline {
  background: var(--rdx-neutral);
}

.status-alarm {
  background: var(--rdx-danger);
}

.status-stale {
  background: var(--rdx-warning);
}

.status-unknown {
  background: var(--rdx-neutral);
}

.status-row div {
  display: flex;
  flex-direction: column;
}

.status-row strong {
  color: var(--rdx-text-strong);
  font-size: 28px;
  line-height: 1;
}

.status-row span:last-child {
  margin-top: 5px;
  color: var(--rdx-text-muted);
  font-size: 11px;
}

.context-note {
  margin: 18px 0 0;
  color: var(--rdx-text-faint);
  font-size: 11px;
  line-height: 1.5;
}

/* PRODUCCIÓN */

.production-list {
  margin: 22px 0 0;
}

.production-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 13px 0;
  border-bottom: 1px solid var(--rdx-border);
}

.production-list dt {
  color: var(--rdx-text-muted);
  font-size: 12px;
}

.production-list dd {
  margin: 0;
  color: var(--rdx-primary);
  font-size: 19px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
}

.production-list .production-main dd {
  font-size: 27px;
}

.data-warning {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 18px;
  padding: 13px 15px;
  border-radius: 9px;
  background: var(--rdx-warning-soft);
}

.data-warning strong {
  color: var(--rdx-warning);
  font-size: 11px;
}

.data-warning span {
  color: var(--rdx-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

/* PROVEEDORES */

.providers-grid {
  display: grid;
  grid-template-columns:
    repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.provider-card {
  min-width: 0;
  padding: 26px;
  border: 1px solid var(--rdx-border);
  border-radius: 15px;
  background: var(--rdx-surface);
  box-shadow:
    0 5px 20px rgb(23 63 51 / 4%);
}

.provider-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.provider-title {
  display: flex;
  align-items: center;
  gap: 13px;
}

.provider-logo {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  place-items: center;
  border-radius: 11px;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: .04em;
}

.provider-hyxi {
  background: var(--rdx-success-soft);
  color: var(--rdx-success);
}

.provider-growatt {
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
}

.provider-title h3,
.incident-card h3 {
  margin: 0;
  color: var(--rdx-text-strong);
  font-size: 19px;
}

.provider-title p,
.incident-card header p {
  margin: 4px 0 0;
  color: var(--rdx-text-faint);
  font-size: 11px;
}

.provider-count {
  color: var(--rdx-text-strong);
  font-size: 24px;
  text-align: right;
}

.provider-count small {
  display: block;
  color: var(--rdx-text-faint);
  font-size: 9px;
  font-weight: 600;
}

.provider-groups {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 22px;
}

.provider-chips {
  display: grid;
  grid-template-columns:
    repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.provider-chip {
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  justify-content: start;
  column-gap: 7px;
  padding: 11px 13px;
  border: 1px solid var(--rdx-border);
  border-radius: 10px;
  background: var(--rdx-surface);
}

.provider-chip strong {
  color: var(--rdx-text-strong);
  font-size: 16px;
}

.provider-chip small {
  grid-column: 1 / -1;
  margin-top: 2px;
  color: var(--rdx-text-faint);
  font-size: 9px;
}

.mini-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.dot-online {
  background: var(--rdx-success);
}

.dot-offline {
  background: var(--rdx-neutral);
}

.dot-alarm {
  background: var(--rdx-danger);
}

.dot-stale {
  background: var(--rdx-warning);
}

.dot-unknown {
  background: var(--rdx-neutral);
}

.provider-footer {
  display: flex;
  justify-content: flex-start;
  gap: 20px;
  margin-top: 18px;
  color: var(--rdx-text-muted);
  font-size: 11px;
}

/* PRODUCCIÓN POR PLANTA */

.text-link {
  color: var(--rdx-primary);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.text-link:hover {
  text-decoration: underline;
}

.top-plants-card {
  padding: 10px 26px 16px;
  border: 1px solid var(--rdx-border);
  border-radius: 15px;
  background: var(--rdx-surface);
  box-shadow:
    0 5px 20px rgb(23 63 51 / 4%);
}

.top-plants-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.top-plant {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 15px 0;
  border-bottom: 1px solid var(--rdx-border);
}

.top-plant:last-child {
  border-bottom: 0;
}

.top-rank {
  width: 22px;
  flex: 0 0 22px;
  color: var(--rdx-text-faint);
  font-size: 12px;
  font-weight: 800;
  text-align: center;
}

.top-plant .provider-logo {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  font-size: 10px;
}

.top-plant-info {
  display: flex;
  width: 220px;
  min-width: 0;
  flex: 0 0 220px;
  flex-direction: column;
  gap: 2px;
}

.top-plant-info strong {
  overflow: hidden;
  color: var(--rdx-text-strong);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-plant-info span {
  color: var(--rdx-text-faint);
  font-size: 10px;
}

.top-bar {
  height: 9px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  border-radius: 99px;
  background: var(--rdx-neutral-soft);
}

.top-bar-fill {
  display: block;
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--rdx-success), var(--rdx-primary));
}

.top-energy {
  display: flex;
  width: 120px;
  flex: 0 0 120px;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.top-energy strong {
  color: var(--rdx-primary);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.top-energy small {
  color: var(--rdx-text-faint);
  font-size: 10px;
}

.top-plants-empty {
  text-align: center;
  color: var(--rdx-text-muted);
}

/* INCIDENCIAS */

.incidents-grid {
  display: grid;
  grid-template-columns:
    repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.incident-card {
  min-width: 0;
  padding: 24px;
  border: 1px solid var(--rdx-border);
  border-radius: 14px;
  background: var(--rdx-surface);
  box-shadow:
    0 5px 20px rgb(23 63 51 / 4%);
}

.incident-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--rdx-border);
}

.incident-card header > div {
  display: flex;
  align-items: center;
  gap: 12px;
}

.incident-card header > strong {
  color: var(--rdx-text-strong);
  font-size: 27px;
}

.unavailable-symbol {
  color: var(--rdx-text-faint) !important;
}

.incident-state {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 18px;
  padding: 15px;
  border-radius: 10px;
}

.incident-state.ok {
  background: var(--rdx-success-soft);
  color: var(--rdx-success);
}

.incident-state.warning {
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
}

.incident-state.unavailable {
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
}

.incident-icon {
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  border-radius: 50%;
  background: rgb(255 255 255 / 65%);
  font-size: 12px;
  font-weight: 900;
}

.incident-state strong {
  display: block;
  font-size: 12px;
}

.incident-state p {
  margin: 4px 0 0;
  font-size: 10px;
  line-height: 1.5;
}

.incident-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 12px;
  padding: 11px 15px;
  border-radius: 9px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 10px;
}

.incident-summary strong {
  color: var(--rdx-text-muted);
  font-size: 11px;
}

/* RESPONSIVE */

@media (max-width: 1100px) {
  .executive-kpis {
    grid-template-columns:
      repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .overview-grid,
  .providers-grid,
  .incidents-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .dashboard-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .header-meta {
    align-items: flex-start;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }

  .section-heading > p {
    text-align: left;
  }
}

@media (max-width: 560px) {
  .dashboard {
    gap: 34px;
  }

  .executive-kpis {
    grid-template-columns: 1fr;
  }

  .status-list {
    grid-template-columns: 1fr;
  }

  .top-plant {
    flex-wrap: wrap;
  }

  .top-plant-info {
    width: auto;
    flex: 1 1 0;
  }

  .top-bar {
    flex: 1 1 100%;
    order: 4;
  }

  .top-energy {
    width: auto;
    flex: 0 0 auto;
  }

  .provider-chips {
    grid-template-columns: 1fr 1fr;
  }
}
</style>