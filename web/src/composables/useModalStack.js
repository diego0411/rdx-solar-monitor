import { nextTick, onUnmounted, watch } from 'vue';

// UX-03C2A: Escape y bloqueo de scroll compartidos por los modales.
// UX-03C2B: foco inicial al abrir y retorno al cerrar, sin trampa de Tab.
// Pila de entradas: Escape cierra solo el modal superior (último abierto).
// El scroll del fondo se bloquea mientras haya al menos un modal y se
// restaura al cerrar el último. Un único listener global con limpieza.
const stack = [];
let keyAttached = false;
let savedOverflow = null;

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function visibleDialogs() {
  try {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
    return [...document.querySelectorAll('.modal[role="dialog"]')]
      .filter(el => typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
  } catch {
    return [];
  }
}

function focusableControls(dialog) {
  try {
    if (!dialog || typeof dialog.querySelectorAll !== 'function') return [];
    return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
      .filter(el => typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
  } catch {
    return [];
  }
}

function firstFocusable(dialog) {
  return focusableControls(dialog)[0] ?? null;
}

function focusDialog(dialog) {
  if (!dialog) return;
  const target = firstFocusable(dialog) ?? dialog;
  try {
    if (target === dialog && typeof dialog.hasAttribute === 'function' && !dialog.hasAttribute('tabindex')) {
      dialog.setAttribute('tabindex', '-1');
    }
    if (typeof target.focus === 'function') target.focus();
  } catch {
    // Foco no disponible: el modal sigue operable por puntero.
  }
}

// El superior visible es el último en DOM (misma z: pinta encima).
function focusTopmost() {
  const dialogs = visibleDialogs();
  focusDialog(dialogs[dialogs.length - 1]);
}

function focusableTrigger(trigger) {
  try {
    if (!trigger || typeof trigger.focus !== 'function') return false;
    if (trigger.isConnected === false) return false;
    if (trigger.disabled) return false;
    if (typeof trigger.getClientRects === 'function' && trigger.getClientRects().length === 0) return false;
    return true;
  } catch {
    return false;
  }
}

function focusFallback() {
  try {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const main = document.getElementById('main-content');
    if (!main || typeof main.focus !== 'function') return;
    if (typeof main.hasAttribute === 'function' && !main.hasAttribute('tabindex')) {
      main.setAttribute('tabindex', '-1');
    }
    main.focus();
  } catch {
    // Sin destino seguro: se conserva el foco actual.
  }
}

function returnFocus(entry) {
  // Queda otro modal: foco al superior visible, nunca al fondo.
  if (stack.length > 0) {
    focusTopmost();
    return;
  }
  if (focusableTrigger(entry.trigger)) {
    try {
      entry.trigger.focus();
      return;
    } catch {
      // Disparador inválido: se usa el destino seguro.
    }
  }
  focusFallback();
}

function drawerOpen() {
  try {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
    return document.querySelector('.app-shell.nav-open') !== null;
  } catch {
    return false;
  }
}

function safeFocus(el) {
  try {
    if (el && typeof el.focus === 'function') el.focus();
  } catch {
    // Foco no disponible: se conserva el actual.
  }
}

function onKeydown(event) {
  if (!event || stack.length === 0) return;
  // El drawer móvil (z superior) gestiona sus propias teclas.
  if (drawerOpen()) return;
  if (event.key === 'Escape') {
    const top = stack[stack.length - 1];
    try {
      top.close();
    } catch {
      // El cierre pertenece a la vista; aquí solo se delega.
    }
    return;
  }
  if (event.key === 'Tab') trapTab(event);
}

// UX-03C2C: contención del foco en el diálogo superior. Tab envuelve del
// último al primero; Shift+Tab, del primero al último. Foco externo se
// redirige según dirección. Sin controles, se retiene el contenedor.
function trapTab(event) {
  const dialogs = visibleDialogs();
  const top = dialogs[dialogs.length - 1];
  if (!top) return;
  const controls = focusableControls(top);
  if (controls.length === 0) {
    focusDialog(top);
    if (typeof event.preventDefault === 'function') event.preventDefault();
    return;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = readActiveElement();
  let redirect = null;
  if (active === first && event.shiftKey) redirect = last;
  else if (active === last && !event.shiftKey) redirect = first;
  else if (typeof top.contains === 'function' ? !top.contains(active) : active !== top) {
    redirect = event.shiftKey ? last : first;
  }
  if (redirect) {
    safeFocus(redirect);
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
}

function attach() {
  if (keyAttached) return;
  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', onKeydown);
      keyAttached = true;
    }
  } catch {
    // Sin ventana: no hay Escape global que gestionar.
  }
}

function detach() {
  if (!keyAttached) return;
  try {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', onKeydown);
    }
  } catch {
    // Limpieza no disponible: nada que liberar.
  }
  keyAttached = false;
}

function lockBody() {
  try {
    if (typeof document === 'undefined' || !document?.body) return;
    if (savedOverflow === null) savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  } catch {
    // Sin DOM: el modal sigue funcionando sin bloqueo.
  }
}

function unlockBody() {
  try {
    if (typeof document === 'undefined' || !document?.body) return;
    if (savedOverflow !== null) {
      document.body.style.overflow = savedOverflow;
      savedOverflow = null;
    }
  } catch {
    // Restauración no disponible: nada que revertir.
  }
}

function refresh() {
  if (stack.length > 0) {
    attach();
    lockBody();
  } else {
    unlockBody();
    detach();
  }
}

function pushEntry(entry) {
  stack.push(entry);
  refresh();
}

function removeEntry(entry) {
  const index = stack.lastIndexOf(entry);
  if (index >= 0) stack.splice(index, 1);
  refresh();
}

function readActiveElement() {
  try {
    if (typeof document === 'undefined') return null;
    return document.activeElement ?? null;
  } catch {
    return null;
  }
}

/**
 * Registra el cierre de un modal mientras `active` sea verdadero.
 * `active` acepta ref o getter; `close` es la función de cierre propia
 * de la vista (la misma del backdrop). Al abrir guarda el foco previo y,
 * tras el render, enfoca el primer control del diálogo (o el contenedor).
 * Al cerrar devuelve el foco al disparador, al modal que quede abierto o
 * a un destino seguro. Devuelve `dispose()`; además se libera al desmontar.
 */
export function useModalEscape(active, close) {
  const entry = { close: null, trigger: null };
  entry.close = () => {
    try {
      close();
    } catch {
      // El error pertenece a la lógica de cierre de la vista.
    }
  };
  const stop = watch(active, open => {
    if (open) {
      entry.trigger = readActiveElement();
      pushEntry(entry);
      // Tras el render (v-if); si ya cerró, no se roba el foco.
      nextTick(() => {
        if (stack.includes(entry)) focusTopmost();
      });
    } else {
      const wasOpen = stack.includes(entry);
      removeEntry(entry);
      // Diferido: el DOM aún conserva el diálogo que se está cerrando.
      if (wasOpen) nextTick(() => returnFocus(entry));
    }
  }, { immediate: true });
  const dispose = () => {
    stop();
    const wasOpen = stack.includes(entry);
    removeEntry(entry);
    if (wasOpen) nextTick(() => returnFocus(entry));
  };
  try {
    onUnmounted(dispose);
  } catch {
    // Fuera de setup (tests): dispose() queda disponible manualmente.
  }
  return dispose;
}

// Solo para aislamiento entre pruebas.
export function __modalStackReset() {
  stack.length = 0;
  unlockBody();
  detach();
}
