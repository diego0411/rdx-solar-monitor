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
const hasSolar = computed(() => numeric(props.realtime.pv_power));
const hasLoad = computed(() => numeric(props.realtime.load_power));
const hasGrid = computed(() => ['grid_import_power', 'grid_export_power', 'current_grid_power']
  .some(key => numeric(props.realtime[key])));
const hasBattery = computed(() => ['battery_charge_power', 'battery_discharge_power', 'battery_power_w', 'battery_soc']
  .some(key => numeric(props.realtime[key])));
const hasFlow = computed(() => hasSolar.value || hasLoad.value || hasGrid.value || hasBattery.value);
const statusLabels = { fresh: 'Datos actuales', stale: 'Datos desactualizados', no_data: 'Sin datos actuales' };
</script>

<template>
  <div v-if="hasFlow" class="energy-flow" :class="`flow-${realtime.data_status}`">
    <header class="flow-header">
      <h3>Flujo energético actual</h3>
      <span class="flow-status"><i></i>{{ statusLabels[realtime.data_status] ?? statusLabels.no_data }}</span>
    </header>

    <div class="flow-diagram">
      <article v-if="hasSolar" class="flow-node solar-node">
        <span class="node-icon" aria-hidden="true">☀</span>
        <div><strong>Solar</strong><span>{{ formatPower(realtime.pv_power) }}</span></div>
      </article>

      <div v-if="hasSolar && hasLoad" class="flow-link horizontal directed">
        <span>{{ formatPower(realtime.pv_power) }}</span><i></i>
      </div>

      <article v-if="hasLoad" class="flow-node load-node">
        <span class="node-icon" aria-hidden="true">⌂</span>
        <div><strong>Consumo</strong><span>{{ formatPower(realtime.load_power) }}</span></div>
      </article>

      <div v-if="hasGrid && hasLoad" class="grid-links">
        <div v-if="numeric(realtime.grid_import_power)" class="flow-link directed reverse">
          <span>Importa {{ formatPower(realtime.grid_import_power) }}</span><i></i>
        </div>
        <div v-if="numeric(realtime.grid_export_power)" class="flow-link directed">
          <span>Exporta {{ formatPower(realtime.grid_export_power) }}</span><i></i>
        </div>
        <div v-if="!numeric(realtime.grid_import_power) && !numeric(realtime.grid_export_power) && numeric(realtime.current_grid_power)" class="flow-link neutral">
          <span>{{ formatPower(realtime.current_grid_power) }}</span><i></i>
        </div>
      </div>

      <article v-if="hasGrid" class="flow-node grid-node">
        <span class="node-icon" aria-hidden="true">⌁</span>
        <div>
          <strong>Red</strong>
          <span v-if="numeric(realtime.grid_import_power)">Importación {{ formatPower(realtime.grid_import_power) }}</span>
          <span v-if="numeric(realtime.grid_export_power)">Exportación {{ formatPower(realtime.grid_export_power) }}</span>
          <span v-if="!numeric(realtime.grid_import_power) && !numeric(realtime.grid_export_power) && numeric(realtime.current_grid_power)">{{ formatPower(realtime.current_grid_power) }}</span>
        </div>
      </article>

      <div v-if="hasBattery && hasLoad" class="battery-links">
        <div v-if="numeric(realtime.battery_charge_power)" class="flow-link directed">
          <span>Carga {{ formatPower(realtime.battery_charge_power) }}</span><i></i>
        </div>
        <div v-if="numeric(realtime.battery_discharge_power)" class="flow-link directed reverse">
          <span>Descarga {{ formatPower(realtime.battery_discharge_power) }}</span><i></i>
        </div>
        <div v-if="!numeric(realtime.battery_charge_power) && !numeric(realtime.battery_discharge_power) && numeric(realtime.battery_power_w)" class="flow-link neutral">
          <span>{{ formatPower(realtime.battery_power_w) }}</span><i></i>
        </div>
      </div>

      <article v-if="hasBattery" class="flow-node battery-node">
        <span class="node-icon" aria-hidden="true">▣</span>
        <div>
          <strong>Batería</strong>
          <span v-if="numeric(realtime.battery_soc)">{{ formatter.format(realtime.battery_soc) }}% SOC</span>
          <span v-if="numeric(realtime.battery_charge_power)">Carga {{ formatPower(realtime.battery_charge_power) }}</span>
          <span v-if="numeric(realtime.battery_discharge_power)">Descarga {{ formatPower(realtime.battery_discharge_power) }}</span>
          <span v-if="!numeric(realtime.battery_charge_power) && !numeric(realtime.battery_discharge_power) && numeric(realtime.battery_power_w)">{{ formatPower(realtime.battery_power_w) }}</span>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.energy-flow { margin: 20px 0 24px; padding: 20px; border: 1px solid #dfe7e1; border-radius: 14px; background: #f8faf8; }
.flow-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.flow-header h3 { margin: 0; color: #174d3c; font-size: 16px; }
.flow-status { display: inline-flex; align-items: center; gap: 7px; color: #607068; font-size: 12px; }
.flow-status i { width: 7px; height: 7px; border-radius: 50%; background: #399461; }
.flow-stale .flow-status i { background: #c08222; }.flow-no_data .flow-status i { background: #8a9991; }
.flow-diagram { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(100px, .7fr) minmax(170px, 1fr) minmax(110px, .8fr) minmax(150px, 1fr); grid-template-rows: auto auto; align-items: center; gap: 14px; min-width: 0; }
.flow-node { display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 82px; padding: 15px; border: 1px solid #dbe6df; border-radius: 12px; background: white; }
.flow-node div { display: grid; min-width: 0; }.flow-node strong { color: #243b32; font-size: 14px; }.flow-node span:not(.node-icon) { color: #5e7066; font-size: 12px; overflow-wrap: anywhere; }
.node-icon { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; background: #e7f2eb; color: #28724f; font-size: 19px; }
.solar-node { grid-column: 1; grid-row: 1; }.load-node { grid-column: 3; grid-row: 1 / 3; }.grid-node { grid-column: 5; grid-row: 1; }.battery-node { grid-column: 5; grid-row: 2; }
.flow-diagram > .horizontal { grid-column: 2; grid-row: 1; }.grid-links { grid-column: 4; grid-row: 1; }.battery-links { grid-column: 4; grid-row: 2; }
.grid-links, .battery-links { display: grid; gap: 9px; min-width: 0; }
.flow-link { display: grid; gap: 5px; min-width: 0; color: #617168; font-size: 10px; text-align: center; }
.flow-link i { position: relative; display: block; height: 2px; background: #75a890; }
.flow-link.directed i::after { content: ''; position: absolute; right: -1px; top: -3px; width: 7px; height: 7px; border-top: 2px solid #4d8b6f; border-right: 2px solid #4d8b6f; transform: rotate(45deg); }
.flow-link.reverse i::after { right: auto; left: -1px; transform: rotate(-135deg); }.flow-link.neutral i { background: #a8b7af; }
.flow-stale .flow-diagram { opacity: .76; }.flow-no_data .flow-diagram { opacity: .55; }
@media (max-width: 900px) { .flow-diagram { grid-template-columns: minmax(120px, 1fr) 70px minmax(145px, 1fr) 80px minmax(130px, 1fr); gap: 10px; } }
@media (max-width: 700px) {
  .flow-diagram { grid-template-columns: minmax(0, 1fr) 56px minmax(0, 1fr); grid-template-rows: repeat(3, auto); }
  .solar-node { grid-column: 1; grid-row: 1; }.flow-diagram > .horizontal { grid-column: 2; grid-row: 1; }.load-node { grid-column: 3; grid-row: 1 / 4; }
  .grid-node { grid-column: 1; grid-row: 2; }.grid-links { grid-column: 2; grid-row: 2; }.battery-node { grid-column: 1; grid-row: 3; }.battery-links { grid-column: 2; grid-row: 3; }
}
@media (max-width: 440px) { .energy-flow { padding: 16px; }.flow-header { align-items: flex-start; flex-direction: column; }.flow-diagram { grid-template-columns: 1fr; }.flow-node, .solar-node, .load-node, .grid-node, .battery-node { grid-column: 1; grid-row: auto; }.flow-diagram > .horizontal, .grid-links, .battery-links { grid-column: 1; grid-row: auto; }.flow-link i { width: 2px; height: 28px; margin: auto; }.flow-link.directed i::after { right: -3px; top: auto; bottom: -1px; transform: rotate(135deg); }.flow-link.reverse i::after { left: -3px; top: -1px; bottom: auto; transform: rotate(-45deg); } }
</style>
