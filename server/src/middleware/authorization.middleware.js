import { supabase } from '../config/supabase.js';

/*
 * Carga el perfil del usuario autenticado (user_profiles) y
 * resuelve el alcance de plantas permitidas.
 *
 * - rdx_admin: alcance global (plantIds = null => todas).
 * - client_admin / client_user: solo las plantas asignadas
 *   en client_plants (0 asignaciones => 0 plantas).
 *
 * Nunca se auto-crea un perfil ni se autoriza por email o
 * dominio: la ausencia de perfil, el perfil inactivo o un rol
 * desconocido resultan en 403.
 */
export async function loadProfile(req, res, next) {
  try {
    const { data, error } = await supabase.from('user_profiles')
      .select('id, client_id, role, display_name, active')
      .eq('id', req.user.id)
      .maybeSingle();

    if (error || !data) {
      return res.status(403).json({ error: 'Sin perfil asignado' });
    }
    if (data.active !== true) {
      return res.status(403).json({ error: 'Perfil inactivo' });
    }

    req.profile = {
      id: data.id,
      client_id: data.client_id ?? null,
      role: data.role,
      display_name: data.display_name ?? null,
      active: data.active,
    };

    if (data.role === 'rdx_admin') {
      req.scope = { client_id: null, plantIds: null };
      return next();
    }

    const { data: assignments, error: scopingError } =
      await supabase.from('client_plants')
        .select('plant_id')
        .eq('client_id', data.client_id);

    if (scopingError) {
      return res.status(503).json({ error: 'No se pudo resolver el alcance del perfil' });
    }

    req.scope = {
      client_id: data.client_id,
      plantIds: new Set((assignments ?? []).map(row => row.plant_id)),
    };

    return next();
  } catch {
    return res.status(503).json({ error: 'No se pudo resolver el perfil' });
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
 * Verifica que una planta pertenezca al alcance del perfil.
 * Para rdx_admin (plantIds null) todo está permitido.
 */
export function plantInScope(scope, plantId) {
  if (!scope) return false;
  if (scope.plantIds === null) return true;
  return scope.plantIds.has(plantId);
}
