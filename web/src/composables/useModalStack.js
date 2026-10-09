import { onUnmounted, watch } from 'vue';

// UX-03C2A: Escape y bloqueo de scroll compartidos por los modales.
// Pila de cierres: Escape cierra solo el modal superior (último abierto).
// El scroll del fondo se bloquea mientras haya al menos un modal y se
// restaura al cerrar el último. Un único listener global con limpieza.
const stack = [];
let keyAttached = false;
let savedOverflow = null;

function drawerOpen() {
  try {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false;
    return document.querySelector('.app-shell.nav-open') !== null;
  } catch {
    return false;
  }
}

function onKeydown(event) {
  if (event?.key !== 'Escape' || stack.length === 0) return;
  // El drawer móvil (z superior) gestiona su propio Escape.
  if (drawerOpen()) return;
  const closeTop = stack[stack.length - 1];
  try {
    closeTop();
  } catch {
    // El cierre pertenece a la vista; aquí solo se delega.
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

function pushCloser(closer) {
  stack.push(closer);
  refresh();
}

function removeCloser(closer) {
  const index = stack.lastIndexOf(closer);
  if (index >= 0) stack.splice(index, 1);
  refresh();
}

/**
 * Registra el cierre de un modal mientras `active` sea verdadero.
 * `active` acepta ref o getter; `close` es la función de cierre propia
 * de la vista (la misma del backdrop). Devuelve `dispose()` para pruebas
 * y limpieza manual; además se libera solo al desmontar.
 */
export function useModalEscape(active, close) {
  const closer = () => {
    try {
      close();
    } catch {
      // El error pertenece a la lógica de cierre de la vista.
    }
  };
  const stop = watch(active, open => {
    if (open) pushCloser(closer);
    else removeCloser(closer);
  }, { immediate: true });
  const dispose = () => {
    stop();
    removeCloser(closer);
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
