import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref, computed } from 'vue';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';

// Run the real component's setup and handlers without a browser or network.
const source = readFileSync(new URL('../src/views/UsersView.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
// Inspect VNodes without DOM directives; setup/submit behavior is tested below.
const render = new Function('Vue', compile(descriptor.template.content, { mode: 'function' }).code)({
  ...Vue, withDirectives: vnode => vnode,
});
const script = compileScript(descriptor, { id: 'users-test' }).content
  .replace(/^import .*;$/gm, '')
  .replace('export default', 'return');
const makeComponent = new Function('deps', `
  const { ref, computed, onMounted, onUnmounted, getMyProfile,
    listUsers, createUser, updateUser, setUserStatus } = deps;
  ${script}
`);

function setup(overrides = {}) {
  const calls = [];
  let unmount;
  const component = makeComponent({
    ref, computed, onMounted() {}, onUnmounted(fn) { unmount = fn; },
    getMyProfile: async () => ({ profile: { role: 'client_admin' } }),
    listUsers: async () => [], setUserStatus: async () => {},
    createUser: async payload => {
      calls.push(payload);
      return { id: 'new', display_name: payload.name, email: payload.email, role: payload.role, active: true };
    },
    updateUser: async (id, payload) => { calls.push(payload); return { id, ...payload }; },
    ...overrides,
  });
  return { view: component.setup({}, { expose() {} }), calls, unmount: () => unmount() };
}

function fill(view) {
  view.openCreate();
  view.form.value = { display_name: ' Name ', email: ' user@example.test ', role: 'client_user' };
  view.password.value = 'Test-only-Password-42!';
  view.confirmPassword.value = view.password.value;
}

test('creation sends name/email/role/password, not confirmation; updates list and clears secrets', async () => {
  const { view, calls } = setup();
  fill(view);
  await view.saveForm();
  assert.deepEqual(Object.keys(calls[0]).sort(), ['email', 'name', 'password', 'role']);
  assert.equal(calls[0].name, 'Name');
  assert.equal(calls[0].email, 'user@example.test');
  assert.equal(view.users.value.length, 1);
  assert.equal('password' in view.users.value[0], false);
  assert.equal(view.password.value, '');
  assert.equal(view.confirmPassword.value, '');
  assert.equal(view.showForm.value, false);
});

test('both passwords required and matching, with minimum length enforced', async () => {
  const { view, calls } = setup();
  for (const [password, confirmation] of [['', ''], ['short', 'short'], ['123456', ''], ['123456', '654321']]) {
    fill(view);
    view.password.value = password;
    view.confirmPassword.value = confirmation;
    await view.saveForm();
    assert.ok(view.formError.value);
  }
  assert.equal(calls.length, 0);
});

test('editing does not require or send passwords', async () => {
  const { view, calls } = setup();
  const user = { id: 'existing', display_name: 'Old', role: 'client_user' };
  view.users.value = [user];
  view.openEdit(user);
  view.form.value.display_name = 'New';
  await view.saveForm();
  assert.deepEqual(calls, [{ display_name: 'New' }]);
  assert.equal(view.users.value[0].display_name, 'New');
});

test('cancel, reopening and unmount clear passwords and reset visibility', () => {
  const { view, unmount } = setup();
  for (const clear of [() => view.closeForm(), () => view.openCreate(), unmount]) {
    fill(view);
    view.showPassword.value = true;
    clear();
    assert.equal(view.password.value, '');
    assert.equal(view.confirmPassword.value, '');
    assert.equal(view.showPassword.value, false);
  }
});

test('duplicate and invalid-password errors leave the form open with safe feedback', async () => {
  for (const status of [409, 400]) {
    const { view } = setup({ createUser: async () => { throw Object.assign(new Error('private provider detail'), { status }); } });
    fill(view);
    await view.saveForm();
    assert.equal(view.showForm.value, true);
    assert.equal(view.formSaving.value, false);
    assert.match(view.formError.value, status === 409 ? /registrado/ : /contraseña/);
    assert.equal(view.formError.value.includes('private provider detail'), false);
    assert.equal(view.users.value.length, 0);
  }
});

test('pending creation cannot be closed or submitted twice', async () => {
  let finish;
  let calls = 0;
  const { view } = setup({ createUser: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  fill(view);
  const pending = view.saveForm();
  view.closeForm();
  await view.saveForm();
  assert.equal(view.showForm.value, true);
  assert.equal(calls, 1);
  finish({ id: 'new', display_name: 'Name' });
  await pending;
  assert.equal(view.showForm.value, false);
  assert.equal(view.password.value, '');
});

test('rendered password inputs are required only on create and visibility toggle changes both', () => {
  const { view } = setup();
  function nodes(node, result = []) {
    if (!node || typeof node !== 'object') return result;
    if (node.type) result.push(node);
    if (Array.isArray(node.children)) node.children.forEach(child => nodes(child, result));
    return result;
  }
  const rendered = () => nodes(render(Vue.proxyRefs(view), []));
  const inputs = () => rendered().filter(node => ['user-password', 'user-confirm-password'].includes(node.props?.id));
  view.openCreate();
  assert.equal(inputs().length, 2);
  assert.ok(inputs().every(node => node.props.type === 'password' && node.props.required !== undefined && node.props.minlength === '6'));
  rendered().find(node => node.props?.['aria-controls'] === 'user-password user-confirm-password').props.onClick();
  assert.ok(inputs().every(node => node.props.type === 'text'));
  rendered().find(node => node.props?.['aria-controls'] === 'user-password user-confirm-password').props.onClick();
  assert.ok(inputs().every(node => node.props.type === 'password'));
  view.openEdit({ id: 'existing', role: 'client_user' });
  assert.equal(inputs().length, 0);
});
