<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { apiFetch } from '../services/api.js';

const hyxiResult = ref(null);
const growattResult = ref(null);

const hyxiLoading = ref(true);
const growattLoading = ref(true);

const hyxiError = ref('');
const growattError = ref('');

const controller = new AbortController();

onMounted(async () => {
  try {
    const data = await apiFetch('/integrations/hyxi/alarms/recent', {
      signal: controller.signal,
    });

    if (!data || !Array.isArray(data.alarms)) {
      throw new Error('Respuesta inválida');
    }

    hyxiResult.value = data;
  } catch {
    if (!controller.signal.aborted) {
      hyxiError.value = 'No se pudo consultar el servicio de alarmas HYXi.';
    }
  } finally {
    hyxiLoading.value = false;
  }
});

onMounted(async () => {
  try {
    const data = await apiFetch('/integrations/growatt/alarms/current', {
      signal: controller.signal,
    });

    if (!data || !Array.isArray(data.alarms)) {
      throw new Error('Respuesta inválida');
    }

    growattResult.value = data;
  } catch {
    if (!controller.signal.aborted) {
      growattError.value = 'No se pudo consultar el servicio de alarmas Growatt.';
    }
  } finally {
    growattLoading.value = false;
  }
});

onUnmounted(() => controller.abort());

const hyxiAvailable = computed(() =>
  !hyxiLoading.value &&
  !hyxiError.value &&
  hyxiResult.value &&
  !hyxiResult.value.partial
);

const growattAvailable = computed(() =>
  !growattLoading.value &&
  !growattError.value &&
  growattResult.value
);

const hyxiAlarms = computed(() => hyxiResult.value?.alarms ?? []);
const growattAlarms = computed(() => growattResult.value?.alarms ?? []);

const totalActive = computed(
  () => hyxiAlarms.value.length + growattAlarms.value.length
);

const unifiedAlarms = computed(() => {
  const hyxi = hyxiAlarms.value.map((item) => {
    const alarm = item.alarm ?? {};

    return {
      provider: 'HYXi',
      plant:
        item.plant?.name ??
        alarm.plantName ??
        item.plant?.external_plant_id ??
        'Sin datos',
      device:
        alarm.deviceName ??
        alarm.deviceSn ??
        'Sin datos',
      code:
        alarm.alarmCode ??
        'Sin datos',
      description:
        alarm.alarmName ??
        'Alarma HYXi',
      date:
        alarm.beginTime ?? null,
    };
  });

  const growatt = growattAlarms.value.map((item) => ({
    provider: 'Growatt',
    plant:
      item.plant?.name ??
      item.plant_name ??
      item.plant?.external_plant_id ??
      'Sin datos',
    device:
      item.device?.name ??
      item.device?.serial_number ??
      item.serial_number ??
      'Sin datos',
    code:
      item.faultType && Number(item.faultType) !== 0
        ? `Falla ${item.faultType}`
        : item.warnCode && Number(item.warnCode) !== 0
          ? `Aviso ${item.warnCode}`
          : 'Incidencia',
    description:
      usableText(item.errorText) ??
      usableText(item.warnText) ??
      'Incidencia detectada',
    date:
      item.collected_at ?? null,
  }));

  return [...hyxi, ...growatt].sort(
    (a, b) => timestamp(b.date) - timestamp(a.date)
  );
});

function usableText(value) {
  if (!value || typeof value !== 'string') return null;

  const text = value.trim();

  if (!text || text.toLowerCase() === 'unknown') return null;

  return text;
}

function timestamp(value) {
  if (!value) return 0;

  if (typeof value === 'number') return value;

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value) {
  if (!value) return 'Sin datos';

  const date =
    typeof value === 'number'
      ? new Date(value)
      : new Date(value);

  if (Number.isNaN(date.getTime())) return 'Sin datos';

  return new Intl.DateTimeFormat('es-BO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
</script>

<template>
  <div class="alarms-page">
    <header class="page-header alarms-header">
      <div>
        <p class="eyebrow">RDX SOLAR MONITOR</p>
        <h1>Alarmas</h1>
        <p class="page-description">
          Supervisión centralizada de incidencias de las plantas fotovoltaicas.
        </p>
      </div>

      <div class="status-pill">
        <span
          class="status-dot"
          :class="{ active: totalActive > 0 }"
        ></span>
        {{ totalActive }} incidencias activas
      </div>
    </header>

    <section class="kpi-grid">
      <article class="card kpi-card">
        <div class="kpi-top">
          <span class="kpi-label">INCIDENCIAS ACTIVAS</span>
          <span class="kpi-icon">!</span>
        </div>

        <strong class="kpi-value">{{ totalActive }}</strong>

        <span
          class="kpi-state"
          :class="{ warning: totalActive > 0 }"
        >
          {{ totalActive ? 'Requieren revisión' : 'Sin incidencias detectadas' }}
        </span>
      </article>

      <article class="card kpi-card">
        <div class="kpi-top">
          <span class="kpi-label">HYXi</span>
          <span class="provider-tag">HYXi</span>
        </div>

        <strong v-if="hyxiLoading" class="kpi-value muted">—</strong>
        <strong v-else-if="hyxiAvailable" class="kpi-value">
          {{ hyxiAlarms.length }}
        </strong>
        <strong v-else class="kpi-value muted">—</strong>

        <span
          class="kpi-state"
          :class="{ unavailable: !hyxiLoading && !hyxiAvailable }"
        >
          <template v-if="hyxiLoading">Consultando…</template>
          <template v-else-if="hyxiAvailable">
            {{ hyxiAlarms.length ? 'Incidencias detectadas' : 'Sin incidencias' }}
          </template>
          <template v-else>Servicio no disponible</template>
        </span>
      </article>

      <article class="card kpi-card">
        <div class="kpi-top">
          <span class="kpi-label">GROWATT</span>
          <span class="provider-tag">Growatt</span>
        </div>

        <strong v-if="growattLoading" class="kpi-value muted">—</strong>
        <strong v-else-if="growattAvailable" class="kpi-value">
          {{ growattAlarms.length }}
        </strong>
        <strong v-else class="kpi-value muted">—</strong>

        <span
          class="kpi-state"
          :class="{ unavailable: !growattLoading && !growattAvailable }"
        >
          <template v-if="growattLoading">Consultando…</template>
          <template v-else-if="growattAvailable">
            {{ growattAlarms.length ? 'Incidencias detectadas' : 'Sin incidencias' }}
          </template>
          <template v-else>Servicio no disponible</template>
        </span>
      </article>
    </section>

    <div
      v-if="!hyxiLoading && !hyxiAvailable"
      class="service-warning"
      role="status"
    >
      <div class="warning-icon">!</div>

      <div>
        <strong>Servicio de alarmas HYXi no disponible</strong>
        <p>
          Las alarmas HYXi no pudieron consultarse. La supervisión Growatt
          continúa operativa.
        </p>
      </div>
    </div>

    <div
      v-if="!growattLoading && !growattAvailable"
      class="service-warning"
      role="status"
    >
      <div class="warning-icon">!</div>

      <div>
        <strong>Servicio de alarmas Growatt no disponible</strong>
        <p>
          No fue posible consultar las incidencias actuales de Growatt.
        </p>
      </div>
    </div>

    <section class="card incidents-card">
      <div class="section-header">
        <div>
          <p class="section-eyebrow">SUPERVISIÓN</p>
          <h2>Incidencias activas</h2>
        </div>

        <span class="incident-count">
          {{ unifiedAlarms.length }}
        </span>
      </div>

      <div
        v-if="hyxiLoading || growattLoading"
        class="empty-state"
        role="status"
      >
        <div class="empty-icon loading-icon">↻</div>
        <strong>Consultando incidencias</strong>
        <p>Recopilando información de los proveedores.</p>
      </div>

      <div
        v-else-if="!unifiedAlarms.length"
        class="empty-state"
      >
        <div class="empty-icon success-icon">✓</div>
        <strong>No hay incidencias activas</strong>
        <p>
          No se detectaron alarmas en las fuentes disponibles.
        </p>
      </div>

      <div v-else class="table-wrapper">
        <table class="alarm-table">
          <thead>
            <tr>
              <th>Proveedor</th>
              <th>Planta</th>
              <th>Dispositivo</th>
              <th>Código / Tipo</th>
              <th>Descripción</th>
              <th>Fecha</th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="(alarm, index) in unifiedAlarms"
              :key="`${alarm.provider}-${alarm.device}-${alarm.code}-${index}`"
            >
              <td>
                <span
                  class="provider-badge"
                  :class="alarm.provider.toLowerCase()"
                >
                  {{ alarm.provider }}
                </span>
              </td>

              <td class="plant-name">
                {{ alarm.plant }}
              </td>

              <td>{{ alarm.device }}</td>

              <td>
                <span class="alarm-code">
                  {{ alarm.code }}
                </span>
              </td>

              <td>{{ alarm.description }}</td>

              <td class="date-cell">
                {{ formatDate(alarm.date) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.alarms-page {
  width: 100%;
  min-width: 0;
}

.alarms-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 24px;
}

.page-description {
  margin-top: 6px;
  color: var(--rdx-text-muted);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 9px 14px;
  border: 1px solid var(--rdx-border);
  border-radius: 999px;
  background: var(--rdx-surface);
  color: var(--rdx-text-muted);
  font-size: 13px;
  font-weight: 600;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--rdx-success);
}

.status-dot.active {
  background: var(--rdx-warning);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin-bottom: 18px;
}

.kpi-card {
  min-width: 0;
  padding: 22px;
}

.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.kpi-label,
.section-eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--rdx-text-muted);
}

.kpi-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-weight: 800;
}

.provider-tag {
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.kpi-value {
  display: block;
  margin: 13px 0 8px;
  font-size: 34px;
  line-height: 1;
  color: var(--rdx-text-strong);
}

.kpi-value.muted {
  color: var(--rdx-text-faint);
}

.kpi-state {
  font-size: 13px;
  color: var(--rdx-success);
}

.kpi-state.warning {
  color: var(--rdx-warning);
}

.kpi-state.unavailable {
  color: var(--rdx-warning);
}

.service-warning {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  margin-bottom: 18px;
  padding: 15px 18px;
  border: 1px solid var(--rdx-warning-soft);
  border-radius: 12px;
  background: var(--rdx-warning-soft);
  color: var(--rdx-warning);
}

.warning-icon {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  flex: 0 0 25px;
  border-radius: 50%;
  background: #f2dfbd;
  font-weight: 800;
}

.service-warning strong {
  display: block;
  font-size: 14px;
}

.service-warning p {
  margin: 3px 0 0;
  font-size: 13px;
}

.incidents-card {
  min-width: 0;
  padding: 0;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 22px;
  border-bottom: 1px solid var(--rdx-border);
}

.section-header h2 {
  margin: 4px 0 0;
  font-size: 18px;
}

.incident-count {
  display: grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  padding: 0 9px;
  border-radius: 999px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.empty-state {
  display: flex;
  min-height: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 35px 20px;
  text-align: center;
}

.empty-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 13px;
  border-radius: 50%;
  font-size: 22px;
  font-weight: 700;
}

.success-icon {
  background: var(--rdx-success-soft);
  color: var(--rdx-success);
}

.loading-icon {
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
}

.empty-state strong {
  color: var(--rdx-text-strong);
  font-size: 15px;
}

.empty-state p {
  margin: 6px 0 0;
  color: var(--rdx-text-muted);
  font-size: 13px;
}

.table-wrapper {
  width: 100%;
  overflow-x: auto;
}

.alarm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.alarm-table th {
  padding: 12px 16px;
  background: var(--rdx-neutral-soft);
  color: var(--rdx-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: left;
  white-space: nowrap;
}

.alarm-table td {
  padding: 15px 16px;
  border-top: 1px solid var(--rdx-border);
  color: var(--rdx-text-muted);
  vertical-align: middle;
}

.plant-name {
  color: var(--rdx-text-strong) !important;
  font-weight: 600;
}

.provider-badge {
  display: inline-flex;
  padding: 5px 9px;
  border-radius: 999px;
  background: var(--rdx-primary-soft);
  color: var(--rdx-accent);
  font-size: 11px;
  font-weight: 700;
}

.provider-badge.growatt {
  background: var(--rdx-primary-soft);
}

.alarm-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--rdx-text-muted);
}

.date-cell {
  white-space: nowrap;
}

@media (max-width: 900px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .alarms-header {
    flex-direction: column;
  }
}

@media (max-width: 600px) {
  .kpi-card {
    padding: 18px;
  }

  .section-header {
    padding: 17px 18px;
  }
}
</style>