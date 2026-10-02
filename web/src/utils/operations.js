// Lógica pura del módulo Operaciones (sin dependencias de Vue ni fetch).
// Centraliza etiquetas, payloads, idempotencia y mensajes de error amigables.

export const requestStatusLabels = {
  requested: 'Solicitada',
  received: 'Recibida',
  preparing: 'En preparación',
  ready: 'Lista para entrega',
  delivered: 'Entregada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
};

export const priorityLabels = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
};

export const reasonLabels = {
  installation: 'Instalación',
  maintenance: 'Mantenimiento',
  warranty: 'Garantía',
  replacement: 'Reemplazo',
  internal: 'Uso interno',
  other: 'Otro',
};

export const eventLabels = {
  requested: 'Solicitud creada',
  received: 'Recibida por almacén',
  preparing_started: 'Preparación iniciada',
  item_prepared: 'Material preparado',
  preparation_updated: 'Preparación actualizada',
  ready: 'Lista para entrega',
  delivered: 'Materiales entregados',
  rejected: 'Solicitud rechazada',
  cancelled: 'Solicitud cancelada',
};

export const requestReasons = Object.keys(reasonLabels);
export const requestPriorities = Object.keys(priorityLabels);
export const requestStatuses = Object.keys(requestStatusLabels);

// Categorías reales de inventory_products (mismas etiquetas que inventario).
export const productCategoryLabels = {
  inverter: 'Inversor',
  solar_panel: 'Panel solar',
  smart_meter: 'Smart meter',
  battery: 'Batería',
  datalogger: 'Datalogger',
  protection: 'Protección',
  structure: 'Estructura',
  cable: 'Cable',
  other: 'Otro',
};

export const productTypeLabels = {
  quantity: 'Por cantidad',
  serialized: 'Serializado',
};

export function productCategoryLabel(category) {
  return productCategoryLabels[category] ?? category ?? '—';
}

export function productTypeLabel(trackingMode) {
  return productTypeLabels[trackingMode] ?? trackingMode ?? '—';
}

// Límite inicial de resultados del selector (no renderizar cientos).
export const PRODUCT_PICKER_PAGE_SIZE = 20;

// Categorías presentes en los datos cargados, etiquetadas y ordenadas.
export function availableCategoryOptions(products = []) {
  const seen = new Set();
  for (const product of products ?? []) {
    if (typeof product?.category === 'string' && product.category !== '') seen.add(product.category);
  }
  return [...seen]
    .map(value => ({ value, label: productCategoryLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

// Búsqueda case-insensitive por nombre, fabricante o modelo (el modelo
// actúa como código). Multi-término con AND.
export function productMatchesSearch(product = {}, search = '') {
  const query = String(search ?? '').trim().toLowerCase();
  if (query === '') return true;
  const haystack = [product?.name, product?.manufacturer, product?.model]
    .filter(value => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return query.split(/\s+/).every(token => haystack.includes(token));
}

// Disponibilidad informativa por tipo (no reserva stock).
export function pickerAvailabilityText(product = {}) {
  const availability = product?.availability;
  if (!availability) return 'Disponibilidad no disponible';
  if (product.tracking_mode === 'serialized') {
    return `Equipos disponibles: ${availability.available_count ?? '—'}`;
  }
  return `Disponible: ${availability.available ?? '—'}`;
}

// Filtra el catálogo del selector: oculta inactivos y ya agregados,
// aplica búsqueda/categoría/tipo y pagina el renderizado.
export function filterPickerProducts(products = [], filters = {}) {
  const {
    search = '',
    category = 'all',
    trackingMode = 'all',
    excludeIds = [],
    limit = PRODUCT_PICKER_PAGE_SIZE,
  } = filters ?? {};
  const excluded = new Set(excludeIds ?? []);
  const matched = (products ?? []).filter(product => {
    if (!product || typeof product.id !== 'string') return false;
    if (product.active === false) return false;
    if (excluded.has(product.id)) return false;
    if (category !== 'all' && product.category !== category) return false;
    if (trackingMode !== 'all' && product.tracking_mode !== trackingMode) return false;
    return productMatchesSearch(product, search);
  });
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : PRODUCT_PICKER_PAGE_SIZE;
  return { results: matched.slice(0, safeLimit), total: matched.length };
}

// Motivos que admiten planta asociada. Para el resto, plant_id se
// normaliza a NULL (el backend también lo fuerza).
export const plantReasons = ['maintenance', 'warranty', 'replacement'];

export function reasonAllowsPlant(reason) {
  return plantReasons.includes(reason);
}

export const destinationTypeLabels = {
  client: 'Cliente',
  other: 'Otro',
};

export const destinationTypes = Object.keys(destinationTypeLabels);

export function destinationTypeLabel(type) {
  return destinationTypeLabels[type] ?? type ?? 'Sin datos';
}

// Normaliza el destino para listado y detalle. Nunca infiere cliente
// desde planta: solo usa destination_client y destination tal cual.
export function destinationDisplay(request = {}) {
  const rawName = request?.destination_client?.name;
  const clientName = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : null;
  const rawDestination = request?.destination;
  const reference = typeof rawDestination === 'string' && rawDestination.trim() !== ''
    ? rawDestination.trim()
    : null;
  return {
    clientName,
    reference,
    primary: clientName ?? reference ?? '—',
    secondary: clientName && reference ? reference : null,
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function statusLabel(status) {
  return requestStatusLabels[status] ?? status ?? 'Sin datos';
}

export function priorityLabel(priority) {
  return priorityLabels[priority] ?? priority ?? 'Sin datos';
}

export function reasonLabel(reason) {
  return reasonLabels[reason] ?? reason ?? 'Sin datos';
}

export function eventLabel(eventType) {
  return eventLabels[eventType] ?? eventType ?? 'Evento';
}

export function isWarehouseRole(role) {
  return role === 'rdx_admin' || role === 'client_admin';
}

export function canCreateRequest(role) {
  return role === 'rdx_admin' || role === 'client_admin' || role === 'client_user';
}

// Acciones de transición de almacén visibles según estado.
// La entrega (ready) y la cancelación se gestionan con flujos propios.
export function transitionActions(status) {
  if (status === 'requested') {
    return [
      { target: 'received', label: 'Recibir' },
      { target: 'rejected', label: 'Rechazar' },
    ];
  }
  if (status === 'received') {
    return [{ target: 'preparing', label: 'Iniciar preparación' }];
  }
  if (status === 'preparing') {
    return [{ target: 'ready', label: 'Marcar lista' }];
  }
  return [];
}

// Estados donde tiene sentido ofrecer la cancelación.
// La autorización final (propiedad client_user incluida) la decide el backend.
export function cancellableStatus(status) {
  return ['requested', 'received', 'preparing', 'ready'].includes(status);
}

export function newIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Continúa con el fallback local.
  }
  const bytes = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map(part => part.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isIdempotencyKey(value) {
  return typeof value === 'string' && uuidPattern.test(value.trim());
}

function positiveQuantity(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^[+]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric > 0 ? text : null;
  }
  return null;
}

function nonNegativeQuantity(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^[+]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric >= 0 ? text : null;
  }
  return null;
}

function optionalText(value, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length > max) return undefined;
  return text === '' ? null : text;
}

// Construye el payload de POST /requests. Nunca incluye
// requested_by ni client_id: el backend usa la identidad autenticada.
export function buildCreatePayload(form = {}) {
  if (!requestReasons.includes(form.reason)) return { error: 'Selecciona un motivo válido.' };
  if (!requestPriorities.includes(form.priority)) return { error: 'Selecciona una prioridad válida.' };
  const lines = Array.isArray(form.lines) ? form.lines : [];
  if (lines.length === 0) return { error: 'Agrega al menos un material a la solicitud.' };
  const seen = new Set();
  const payloadLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? {};
    const productId = typeof line.product_id === 'string' ? line.product_id.trim().toLowerCase() : '';
    if (!uuidPattern.test(productId)) return { error: `La línea ${index + 1} necesita un producto válido.` };
    if (seen.has(productId)) return { error: 'No repitas el mismo producto en la solicitud.' };
    seen.add(productId);
    const quantity = positiveQuantity(line.requested_quantity);
    if (quantity === null) return { error: `La línea ${index + 1} necesita una cantidad mayor a 0.` };
    const entry = { product_id: productId, requested_quantity: quantity };
    const observations = optionalText(line.observations, 4000);
    if (observations === undefined) return { error: `La observación de la línea ${index + 1} es demasiado larga.` };
    if (observations !== null) entry.observations = observations;
    payloadLines.push(entry);
  }
  const payload = { reason: form.reason, priority: form.priority, lines: payloadLines };
  if (reasonAllowsPlant(form.reason)) {
    if (form.plant_id !== undefined && form.plant_id !== null && form.plant_id !== '') {
      if (typeof form.plant_id !== 'string' || !uuidPattern.test(form.plant_id.trim())) {
        return { error: 'La planta seleccionada no es válida.' };
      }
      payload.plant_id = form.plant_id.trim().toLowerCase();
    }
  }
  const destinationType = form.destination_type === undefined || form.destination_type === null
    || form.destination_type === '' ? 'client' : form.destination_type;
  if (!destinationTypes.includes(destinationType)) return { error: 'Selecciona un tipo de destino válido.' };
  if (destinationType === 'client') {
    if (form.destination_client_id === undefined || form.destination_client_id === null
      || form.destination_client_id === '') {
      return { error: 'Selecciona el cliente destino.' };
    }
    if (typeof form.destination_client_id !== 'string'
      || !uuidPattern.test(form.destination_client_id.trim())) {
      return { error: 'El cliente destino seleccionado no es válido.' };
    }
    payload.destination_client_id = form.destination_client_id.trim().toLowerCase();
    const reference = optionalText(form.destination, 400);
    if (reference === undefined) return { error: 'El lugar de entrega es demasiado largo.' };
    if (reference !== null) payload.destination = reference;
  } else {
    const destination = optionalText(form.destination, 400);
    if (destination === undefined) return { error: 'El destino es demasiado largo.' };
    if (destination === null) return { error: 'Indica el destino de la solicitud.' };
    payload.destination = destination;
  }
  if (form.required_at !== undefined && form.required_at !== null && form.required_at !== '') {
    if (typeof form.required_at !== 'string' || !Number.isFinite(Date.parse(form.required_at))) {
      return { error: 'La fecha requerida no es válida.' };
    }
    payload.required_at = new Date(form.required_at).toISOString();
  }
  const observations = optionalText(form.observations, 4000);
  if (observations === undefined) return { error: 'Las observaciones son demasiado largas.' };
  if (observations !== null) payload.observations = observations;
  return { payload };
}

// Construye el objeto deliveries para POST /deliver.
// Incluye TODAS las líneas (incluso cantidad 0) como exige el contrato RPC.
export function buildDeliveries(lines = [], quantities = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return { error: 'La solicitud no tiene líneas para entregar.' };
  const deliveries = {};
  for (const line of lines) {
    const prepared = Number(line?.prepared_quantity ?? NaN);
    if (!Number.isFinite(prepared) || prepared < 0) {
      return { error: 'La cantidad preparada de una línea no es válida.' };
    }
    const raw = quantities[line.id];
    // Valor inicial de UX: lo preparado. Ausencia equivale a 0 explícito.
    const quantity = nonNegativeQuantity(raw === undefined || raw === null || raw === '' ? 0 : raw);
    if (quantity === null) return { error: 'Revisa las cantidades a entregar (0 a lo preparado).' };
    if (Number(quantity) > prepared) {
      return { error: 'No puedes entregar más de lo preparado en una línea.' };
    }
    deliveries[line.id] = quantity;
  }
  return { deliveries };
}

export function isPartialDelivery(lines = [], deliveries = {}) {
  let requested = 0;
  let delivered = 0;
  for (const line of lines) {
    const want = Number(line?.requested_quantity ?? NaN);
    const give = Number(deliveries[line?.id] ?? NaN);
    if (!Number.isFinite(want) || !Number.isFinite(give)) return false;
    requested += want;
    delivered += give;
  }
  return delivered < requested;
}

// Mensajes amigables para errores del backend de operaciones.
// El backend responde textos fijos en español; se reconocen por
// fragmento (y por código por si alguna vía los expone).
export function friendlyOperationsError(failure) {
  const text = `${failure?.body?.error ?? ''} ${failure?.detail ?? ''} ${failure?.message ?? ''}`;
  if (/ITEM_ALREADY_RESERVED|ya está reservado|ya fue preparado/i.test(text)) {
    return 'Este equipo ya está preparado en otra solicitud.';
  }
  if (/INSUFFICIENT_STOCK|Stock insuficiente/i.test(text)) {
    return 'No existe stock suficiente para completar la entrega.';
  }
  if (/PREPARATION_INCONSISTENT|PREPARED_ITEMS_MISMATCH|PREPARED_QUANTITY_EXCEEDS|inconsistente|excede lo solicitado/i.test(text)) {
    return 'La preparación de materiales está incompleta o es inconsistente.';
  }
  if (/DELIVERY_LINES_MISMATCH|todas las líneas/i.test(text)) {
    return 'La información de entrega no coincide con los materiales de la solicitud.';
  }
  if (/IDEMPOTENCY_PAYLOAD_MISMATCH|idempotencia/i.test(text)) {
    return 'Esta acción ya fue registrada con otros datos. Se actualizó el detalle; revísalo antes de reintentar.';
  }
  if (failure?.status === 403) return 'No tienes permiso para realizar esta acción.';
  if (failure?.status === 404) return 'La solicitud ya no está disponible.';
  if (failure?.status === 400) return 'Revisa los datos ingresados e inténtalo de nuevo.';
  return 'No se pudo completar la acción. Comprueba la conexión y vuelve a intentarlo.';
}
