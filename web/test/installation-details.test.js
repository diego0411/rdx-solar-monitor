import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';
import { theoreticalPanelCapacityKwp } from '../src/utils/installationDetails.js';

const { descriptor } = parse(readFileSync(new URL('../src/components/PlantInstallationDetails.vue', import.meta.url), 'utf8'));
const code = compileScript(descriptor, { id: 'installation-test' }).content
  .replace(/^import .*;$/gm, '').replace('export default', 'return');
function setup(apiFetch) {
  const deps = { ref, computed, watch() {}, onMounted() {}, theoreticalPanelCapacityKwp,
    apiFetch, getMyProfile: async () => ({}) };
  const component = new Function(...Object.keys(deps), code)(...Object.values(deps));
  const view = component.setup({ plantId: 'p', plant: {}, devices: [] }, { expose() {} });
  view.canManage.value = true;
  return view;
}

test('editing is blocked during loading and after GET failure, without hiding the error', async () => {
  let reject;
  const view = setup(() => new Promise((_, no) => { reject = no; }));
  const pending = view.load();
  assert.doesNotThrow(() => view.startEditing());
  assert.equal(view.editing.value, false);
  reject(new Error('API unavailable'));
  await pending;
  assert.equal(view.loading.value, false);
  assert.equal(view.details.value, null);
  assert.ok(view.error.value);
  assert.doesNotThrow(() => view.startEditing());
  assert.equal(view.editing.value, false);
  assert.ok(view.error.value);
});

test('successful empty GET creates a valid null-filled record and permits admin editing', async () => {
  for (const response of [null, {}, { panel_count: null }]) {
    const view = setup(async () => response);
    await view.load();
    assert.equal(Object.keys(view.details.value).length, 7);
    assert.ok(Object.values(view.details.value).every(value => value === null));
    view.startEditing();
    assert.equal(view.editing.value, true);
    assert.deepEqual(view.form.value, view.emptyForm());
  }
});

test('read-only users cannot start editing even after successful load', async () => {
  const view = setup(async () => ({ panel_count: 10, panel_power_w: 550, tilt_degrees: 0 }));
  view.canManage.value = false;
  await view.load();
  view.startEditing();
  assert.equal(view.editing.value, false);
  assert.equal(view.theoreticalCapacity.value, 5.5);
  assert.equal(view.form.value.tilt_degrees, 0);
});

test('invalid API responses remain errors, and a later successful load restores editing', async () => {
  let response = [];
  const view = setup(async () => response);
  await view.load();
  assert.ok(view.error.value);
  assert.equal(view.details.value, null);
  response = { panel_count: 2 };
  await view.load();
  assert.equal(view.error.value, '');
  view.startEditing();
  assert.equal(view.editing.value, true);
  assert.equal(view.form.value.panel_count, 2);
});
