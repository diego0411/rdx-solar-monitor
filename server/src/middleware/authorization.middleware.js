import { supabase } from '../config/supabase.js';
import { MODULE_PERMISSIONS } from '../config/modulePermissions.js';
import { elapsedMs, metricsEnabled } from './httpMetrics.middleware.js';

export { MODULE_PERMISSIONS };

/*
 * Carga el perfil del usuario autenticado (user_profiles).
 *
 * Alcance de plantas: global para todos los roles autenticados
 * (plantIds = null => todas). NO depende de clients, client_plants
 * ni user_plants: la segmentación por plantas se retiró del modelo;
 * el control fino para client_user es por módulos (requireModuleAccess).
 *
 * Nunca se auto-crea un perfil ni se autoriza por email o
 * dominio: la ausencia de perfil, el perfil inactivo o un rol
 * desconocido resultan en 403.
 */
export async function loadProfile(req, res, next) {
  // Sub-medición opt-in: se registra también en error, sin exponer el perfil.
  const started = metricsEnabled() ? process.hrtime.bigint() : null;
  try {
    const { data, error } = await supabase.from('user_profiles')
      .select('id, client_id, role, display_name, active, module_permissions')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error || !data) {
      return res.status(403).json({ error: 'Sin perfil asignado' });
    }
    if (data.active !== true) {
      return res.status(403).json({ error: 'Perfil inactivo' });
    }

    if (!['rdx_admin', 'client_admin', 'client_user'].includes(data.role)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    req.profile = {
      id: data.id,
      client_id: data.client_id ?? null,
      role: data.role,
      display_name: data.display_name ?? null,
      active: data.active,
      module_permissions: Array.isArray(data.module_permissions) ? data.module_permissions : [],
    };

    req.scope = {
      client_id: null,
      plantIds: null,
    };

    return next();
  } catch {
    return res.status(503).json({ error: 'No se pudo resolver el perfil' });
  } finally {
    if (started !== null) res.locals.profile_ms = elapsedMs(started);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.profile || !roles.includes(req.profile.role)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    return next();
  };
}

/*
 * Gate de acceso por módulo. Se ejecuta DESPUÉS de requireAuth+loadProfile.
 * Es ADICIONAL a requireRoles, nunca sustituto: el permiso controla QUÉ
 * módulos, el rol controla QUÉ acciones (los writer checks siguen mandando).
 *
 * - rdx_admin / client_admin: bypass por rol (acceso completo).
 * - client_user: requiere cada permiso solicitado en module_permissions.
 * - rol desconocido o perfil ausente: denegar.
 */
export function requireModuleAccess(...modules) {
  return (req, res, next) => {
    const role = req.profile?.role;
    if (role === 'rdx_admin' || role === 'client_admin') {
      return next();
    }
    if (role !== 'client_user') {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    const granted = Array.isArray(req.profile?.module_permissions)
      ? req.profile.module_permissions
      : [];
    if (modules.every(module => granted.includes(module))) {
      return next();
    }
    return res.status(403).json({ error: 'Acceso denegado' });
  };
}

/*
 * Verifica que una planta pertenezca al alcance del perfil.
 * Con scope global (plantIds null) todo está permitido.
 */
export function plantInScope(scope, plantId) {
  if (!scope) return false;
  if (scope.plantIds === null) return true;
  return scope.plantIds.has(plantId);
}
