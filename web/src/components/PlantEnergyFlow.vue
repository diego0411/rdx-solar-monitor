<script setup>
import { computed } from 'vue';

const props = defineProps({ realtime: { type: Object, required: true } });
const formatter = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 });
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const formatPower = value => {
  if (!numeric(value)) return 'Sin datos';
  return Math.abs(value) >= 1000
    ? `${formatter.format(value / 1000)} kW`
    : `${formatter.format(value)} W`;
};
const rt = computed(() => props.realtime ?? {});
const hasSolar = computed(() => numeric(rt.value.pv_power));
const hasLoad = computed(() => numeric(rt.value.load_power));
const hasGrid = computed(() => ['grid_import_power', 'grid_export_power', 'current_grid_power']
  .some(key => numeric(rt.value[key])));
const hasBattery = computed(() => ['battery_charge_power', 'battery_discharge_power', 'battery_power_w', 'battery_soc']
  .some(key => numeric(rt.value[key])));
const hasFlow = computed(() => hasSolar.value || hasLoad.value || hasGrid.value || hasBattery.value);
const batteryPower = computed(() => numeric(rt.value.battery_charge_power) || numeric(rt.value.battery_discharge_power)
  ? null
  : rt.value.battery_power_w);
const gridRaw = computed(() => numeric(rt.value.grid_import_power) || numeric(rt.value.grid_export_power)
  ? null
  : rt.value.current_grid_power);
const mode = computed(() => (hasBattery.value ? 'hybrid' : 'ongrid'));
const isActive = value => numeric(value) && value > 0;
const isZero = value => numeric(value) && value === 0;
const linkState = value => (isActive(value) ? 'active' : (isZero(value) ? 'zero' : ''));
const statusLabels = { fresh: 'Actual', stale: 'Atrasada', no_data: 'Sin datos' };
</script>

<template>
  <div v-if="hasFlow" class="energy-flow" :class="[`flow-${rt.data_status}`, `mode-${mode}`]">
    <header class="flow-header">
      <h3>Flujo energético actual</h3>
      <span class="flow-status"><i></i>{{ statusLabels[rt.data_status] ?? statusLabels.no_data }}</span>
    </header>

    <div class="flow-diagram">
      <article v-if="hasSolar" class="flow-node solar-node">
        <span class="node-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></span>
        <div class="node-text"><strong>Solar</strong><span>{{ formatPower(rt.pv_power) }}</span></div>
      </article>

      <div v-if="hasSolar" class="flow-link link-sol" :class="linkState(rt.pv_power)" role="img" :aria-label="`Solar → sistema, ${formatPower(rt.pv_power)}`">
        <span class="link-label">{{ formatPower(rt.pv_power) }}</span><i class="ln"></i>
      </div>

      <article class="flow-node inverter-node">
        <span class="node-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="7" width="16" height="10" rx="2" stroke="currentColor" stroke-width="2" /><path d="M8 12h3l1-2 2 4 1-2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
        <div class="node-text">
          <strong>Inversor</strong>
          <span v-if="numeric(rt.ac_power)">AC {{ formatPower(rt.ac_power) }}</span>
        </div>
      </article>

      <div v-if="hasLoad" class="flow-link link-ld" :class="linkState(rt.load_power)" role="img" :aria-label="`Sistema → Consumo, ${formatPower(rt.load_power)}`">
        <i class="ln"></i><span class="link-label">{{ formatPower(rt.load_power) }}</span>
      </div>

      <article v-if="hasLoad" class="flow-node load-node">
        <span class="node-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3l9-8z" fill="currentColor" /></svg></span>
        <div class="node-text"><strong>Consumo</strong><span>{{ formatPower(rt.load_power) }}</span></div>
      </article>

      <div v-if="hasGrid" class="grid-links">
        <div v-if="numeric(rt.grid_import_power)" class="flow-link link-imp" :class="linkState(rt.grid_import_power)" role="img" :aria-label="`Red → sistema, ${formatPower(rt.grid_import_power)}`">
          <span class="link-label">Importa {{ formatPower(rt.grid_import_power) }}</span><i class="ln"></i>
        </div>
        <div v-if="numeric(rt.grid_export_power)" class="flow-link link-exp" :class="linkState(rt.grid_export_power)" role="img" :aria-label="`Sistema → Red, ${formatPower(rt.grid_export_power)}`">
          <span class="link-label">Exporta {{ formatPower(rt.grid_export_power) }}</span><i class="ln"></i>
        </div>
        <div v-if="!numeric(rt.grid_import_power) && !numeric(rt.grid_export_power) && numeric(gridRaw)" class="flow-link link-neutral">
          <span class="link-label">{{ formatPower(gridRaw) }}</span><i class="ln"></i>
        </div>
      </div>

      <article v-if="hasGrid" class="flow-node grid-node">
        <span class="node-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 5v14M12 5v14M19 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg></span>
        <div class="node-text">
          <strong>Red</strong>
          <span v-if="numeric(rt.grid_import_power)">Importación {{ formatPower(rt.grid_import_power) }}</span>
          <span v-if="numeric(rt.grid_export_power)">Exportación {{ formatPower(rt.grid_export_power) }}</span>
          <span v-if="!numeric(rt.grid_import_power) && !numeric(rt.grid_export_power) && numeric(gridRaw)">{{ formatPower(gridRaw) }}</span>
        </div>
      </article>

      <div v-if="hasBattery" class="battery-links">
        <div v-if="numeric(rt.battery_charge_power)" class="flow-link link-chg" :class="linkState(rt.battery_charge_power)" role="img" :aria-label="`Sistema → Batería, ${formatPower(rt.battery_charge_power)}`">
          <span class="link-label">Carga {{ formatPower(rt.battery_charge_power) }}</span><i class="ln"></i>
        </div>
        <div v-if="numeric(rt.battery_discharge_power)" class="flow-link link-dch" :class="linkState(rt.battery_discharge_power)" role="img" :aria-label="`Batería → sistema, ${formatPower(rt.battery_discharge_power)}`">
          <span class="link-label">Descarga {{ formatPower(rt.battery_discharge_power) }}</span><i class="ln"></i>
        </div>
        <div v-if="!numeric(rt.battery_charge_power) && !numeric(rt.battery_discharge_power) && numeric(batteryPower)" class="flow-link link-neutral">
          <span class="link-label">{{ formatPower(batteryPower) }}</span><i class="ln"></i>
        </div>
      </div>

      <article v-if="hasBattery" class="flow-node battery-node">
        <span class="node-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="9" width="16" height="7" rx="1.5" stroke="currentColor" stroke-width="2" /><path d="M21 11v3M6.5 12v1M12 12v1M14.5 12v1" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></span>
        <div class="node-text">
          <strong>Batería</strong>
          <span v-if="numeric(rt.battery_soc)">{{ formatter.format(rt.battery_soc) }}% SOC</span>
          <span v-if="numeric(rt.battery_charge_power)">Carga {{ formatPower(rt.battery_charge_power) }}</span>
          <span v-if="numeric(rt.battery_discharge_power)">Descarga {{ formatPower(rt.battery_discharge_power) }}</span>
          <span v-if="!numeric(rt.battery_charge_power) && !numeric(rt.battery_discharge_power) && numeric(batteryPower)">{{ formatPower(batteryPower) }}</span>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.energy-flow { margin: 20px 0 24px; padding: 20px; border: 1px solid var(--rdx-border); border-radius: var(--rdx-radius-lg); background: var(--rdx-background); }
.flow-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.flow-header h3 { margin: 0; color: var(--rdx-primary); font-size: 16px; }
.flow-status { display: inline-flex; align-items: center; gap: 7px; color: var(--rdx-text-muted); font-size: 12px; }
.flow-status i { width: 7px; height: 7px; border-radius: 50%; background: var(--rdx-success); }
.flow-stale .flow-status i { background: var(--rdx-warning); }
.flow-no_data .flow-status i { background: var(--rdx-neutral); }

.flow-diagram { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(68px, .55fr) minmax(140px, 1fr) minmax(72px, .6fr) minmax(120px, 1fr); grid-template-rows: auto 52px auto; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }
.solar-node { grid-column: 3; grid-row: 1; }
.link-sol { grid-column: 3; grid-row: 2; }
.inverter-node { grid-column: 3; grid-row: 3; }
.link-ld { grid-column: 2; grid-row: 3; }
.load-node { grid-column: 1; grid-row: 3; }
.grid-links { grid-column: 4; grid-row: 3; }
.grid-node { grid-column: 5; grid-row: 3; align-self: center; }
.battery-links { grid-column: 4; grid-row: 1; }
.battery-node { grid-column: 5; grid-row: 1; }

.flow-node { display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 92px; padding: 16px; border: 1px solid var(--rdx-border); border-radius: 12px; border-top-width: 3px; background: var(--rdx-surface); }
.node-icon { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 auto; border-radius: 12px; }
.node-icon svg { width: 22px; height: 22px; }
.node-text { display: grid; gap: 2px; min-width: 0; }
.node-text strong { color: var(--rdx-text); font-size: 14px; }
.node-text span { color: var(--rdx-text-muted); font-size: 12px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.solar-node { border-top-color: var(--rdx-success); }
.solar-node .node-icon { background: var(--rdx-success-soft); color: var(--rdx-success); }
.inverter-node { border-top-color: var(--rdx-primary); }
.inverter-node .node-icon { background: var(--rdx-primary-soft); color: var(--rdx-primary); }
.load-node { border-top-color: var(--rdx-warning); }
.load-node .node-icon { background: var(--rdx-warning-soft); color: var(--rdx-warning); }
.grid-node { border-top-color: var(--rdx-accent); }
.grid-node .node-icon { background: var(--rdx-primary-soft); color: var(--rdx-accent); }
.battery-node { border-top-color: var(--rdx-success); }
.battery-node .node-icon { background: var(--rdx-success-soft); color: var(--rdx-success); }

.grid-links, .battery-links { display: grid; gap: 10px; min-width: 0; }
.flow-link { display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 0; color: var(--rdx-text-muted); font-size: 10px; font-weight: 500; text-align: center; line-height: 1.3; }
.flow-link .ln { position: relative; display: block; width: 100%; height: 2px; background: currentColor; border-radius: 2px; }
.flow-link .ln::after { content: ''; position: absolute; width: 7px; height: 7px; border-top: 2px solid; border-right: 2px solid; }
.flow-link.active { color: var(--rdx-success); font-weight: 600; }
.link-imp.active, .link-exp.active { color: var(--rdx-accent); }
.link-ld.active { color: var(--rdx-warning); }
.link-chg.active, .link-dch.active { color: var(--rdx-success); }
.flow-link.zero { color: var(--rdx-text-faint); opacity: .6; }
.flow-link.link-neutral { color: var(--rdx-text-faint); }
.link-neutral .ln::after { display: none; }

.link-exp .ln::after, .link-chg .ln::after { right: -1px; left: auto; top: -3px; bottom: auto; transform: rotate(45deg); }
.link-imp .ln::after, .link-dch .ln::after { left: -1px; right: auto; top: -3px; bottom: auto; transform: rotate(-135deg); }
.link-sol .ln { width: 2px; height: 30px; }
.link-sol .ln::after { left: -3px; right: auto; top: auto; bottom: -1px; transform: rotate(135deg); }
.link-ld { flex-direction: column-reverse; }
.link-ld .ln::after { left: -1px; right: auto; top: -3px; bottom: auto; transform: rotate(-135deg); }

.flow-stale .flow-diagram { opacity: .78; }
.flow-no_data .flow-diagram { opacity: .55; }

@media (max-width: 900px) {
  .flow-diagram { grid-template-columns: minmax(112px, 1fr) 66px minmax(128px, 1fr) 72px minmax(112px, 1fr); gap: 12px 8px; }
  .flow-node { min-height: 84px; padding: 13px; gap: 10px; }
  .node-icon { width: 34px; height: 34px; }
  .node-icon svg { width: 19px; height: 19px; }
}

@media (max-width: 900px) {
  .flow-diagram { grid-template-columns: minmax(0, 260px); grid-template-rows: auto; gap: 6px; justify-content: center; margin: 0 auto; }
  .flow-diagram > * { grid-column: 1; grid-row: auto; }
  .flow-node { max-width: 100%; justify-self: stretch; }
  .node-text { align-items: center; text-align: center; }
  .flow-node { justify-content: center; }
  .flow-link { padding: 3px 0; }
  .link-sol .ln, .link-exp .ln, .link-chg .ln, .link-ld .ln, .link-imp .ln, .link-dch .ln { width: 2px; height: 24px; }
  .link-neutral .ln { width: 2px; height: 18px; }
  .link-sol .ln::after, .link-exp .ln::after, .link-chg .ln::after, .link-ld .ln::after { left: -3px; right: auto; top: auto; bottom: -1px; transform: rotate(135deg); }
  .link-imp .ln::after, .link-dch .ln::after { left: -3px; right: auto; top: -1px; bottom: auto; transform: rotate(-45deg); }
}

@media (max-width: 440px) {
  .energy-flow { padding: 16px; }
  .flow-header { align-items: flex-start; flex-direction: column; gap: 8px; margin-bottom: 14px; }
}
</style>
