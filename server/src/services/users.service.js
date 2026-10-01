import { supabase } from '../config/supabase.js';
import {
  listUserProfiles,
  getUserProfileById,
  createUserProfile,
  updateUserProfile,
} from '../repositories/userProfiles.repository.js';
import { MODULE_PERMISSIONS } from '../config/modulePermissions.js';

const MANAGED_ROLES = ['client_admin', 'client_user'];
const PATCH_FIELDS = ['display_name', 'role', 'module_permissions'];

function codedError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/*
 * Un perfil es gestionable por este módulo solo si su rol es cliente.
 * rdx_admin nunca es gestionable. El acceso a plantas vive en user_plants,
 * no en clientes: client_id físico legacy no participa en autorización.
 */
export function isManagedProfile(profile) {
  return !!profile
    && MANAGED_ROLES.includes(profile.role);
}

export function visibleProfiles(profiles, actor) {
  if (actor.role === 'rdx_admin') {
    return profiles.filter(isManagedProfile);
  }

  return [];
}

/*
 * Resuelve el perfil objetivo o lanza 404 si no existe
 * o no es gestionable. Solo rdx_admin administra usuarios.
 */
export function resolveTarget(target, actor) {
  if (actor?.role !== 'rdx_admin') {
    throw codedError(403, 'No tienes permiso para administrar usuarios');
  }

  if (!isManagedProfile(target)) {
    throw codedError(404, 'Usuario no encontrado');
  }

  return target;
}

export function validEmail(value) {
  return typeof value === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function cleanDisplayName(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw codedError(400, 'display_name inválido');
  const trimmed = value.trim();
  if (trimmed.length > 120) throw codedError(400, 'display_name inválido');
  return trimmed === '' ? null : trimmed;
}

/*
 * Decide role y permisos efectivos de creación.
 * Solo rdx_admin administra usuarios en esta fase.
 * Crear client_admin/client_user NO requiere cliente ni plantas:
 * client_user recibe module_permissions explícitos ([] si se omiten).
 * client_admin hace bypass por rol (se almacenan vacíos).
 */
export function resolveCreate(actor, body) {
  if (actor?.role !== 'rdx_admin') {
    throw codedError(403, 'No tienes permiso para crear usuarios');
  }
  const { email, role } = body ?? {};
  const display_name = body?.name ?? body?.display_name;

  if (!validEmail(email)) throw codedError(400, 'email inválido');
  if (!MANAGED_ROLES.includes(role)) {
    throw codedError(403, 'No se puede crear ese rol');
  }

  return {
    email: email.trim(),
    display_name: cleanDisplayName(display_name),
    role,
    module_permissions: role === 'client_user'
      ? validateModulePermissions(body?.module_permissions)
      : [],
  };
}

export function validateModulePermissions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw codedError(400, 'module_permissions inválido');
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || !MODULE_PERMISSIONS.includes(entry)) {
      throw codedError(400, 'module_permissions inválido');
    }
    seen.add(entry);
  }
  return [...seen];
}

/*
 * Valida campos de PATCH. Solo display_name y role.
 */
export function resolvePatch(actor, target, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw codedError(400, 'Perfil inválido');
  }

  for (const key of Object.keys(body)) {
    if (!PATCH_FIELDS.includes(key)) {
      throw codedError(400, `Campo no permitido: ${key}`);
    }
  }

  const values = {};

  if (body.display_name !== undefined) {
    values.display_name = cleanDisplayName(body.display_name);
  }

  if (body.module_permissions !== undefined) {
    values.module_permissions = validateModulePermissions(body.module_permissions);
  }

  if (body.role !== undefined) {
    if (body.role === target.role) {
      // Sin cambio: se permite como no-op.
    } else if (!MANAGED_ROLES.includes(body.role)) {
      throw codedError(403, 'No se puede asignar ese rol');
    } else {
      values.role = body.role;
    }
  }

  if (target.id === actor.id && values.role !== undefined) {
    throw codedError(403, 'No se puede cambiar el rol propio');
  }

  return values;
}

export function resolveStatus(actor, target, active) {
  if (typeof active !== 'boolean') {
    throw codedError(400, 'active debe ser true o false');
  }

  if (target.id === actor.id) {
    throw codedError(403, 'No se puede cambiar el estado propio');
  }

  return active;
}

async function authEmailById(authAdmin, id, emailById) {
  if (!emailById.has(id)) {
    const { data, error } = await authAdmin.getUserById(id);
    if (error || !data?.user) return null;
    emailById.set(id, data.user.email ?? null);
  }
  return emailById.get(id) ?? null;
}

function toPublicUser(profile, email) {
  return {
    id: profile.id,
    email,
    display_name: profile.display_name ?? null,
    role: profile.role,
    active: profile.active,
    module_permissions: Array.isArray(profile.module_permissions) ? profile.module_permissions : [],
    created_at: profile.created_at ?? null,
  };
}

export async function listUsers(actor) {
  const profiles = visibleProfiles(await listUserProfiles(), actor);

  const emailById = new Map();
  const pageSize = 100;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: pageSize });
    if (error) throw codedError(503, 'No se pudieron consultar los usuarios');
    for (const user of data?.users ?? []) {
      emailById.set(user.id, user.email ?? null);
    }
    if (!data?.users || data.users.length < pageSize) break;
  }

  const users = [];
  for (const profile of profiles) {
    users.push(toPublicUser(
      profile,
      await authEmailById(supabase.auth.admin, profile.id, emailById),
    ));
  }
  return users;
}

function authConflict(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return ['email_exists', 'user_already_exists'].includes(error?.code)
    || error?.status === 409
    || message.includes('already been registered')
    || message.includes('already exists')
    || message.includes('duplicate');
}

export async function createUser(actor, body) {
  const resolved = resolveCreate(actor, body);
  const password = body?.password;
  // Supabase applies the project's current password policy as well.
  if (typeof password !== 'string' || password.length < 6 || !password.trim()) {
    throw codedError(400, 'La contraseña debe tener al menos 6 caracteres');
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: resolved.email,
    password,
    email_confirm: true,
    user_metadata: { display_name: resolved.display_name },
  });

  if (error || !data?.user) {
    if (error?.code === 'weak_password'
      || error?.name === 'AuthWeakPasswordError'
      || (['validation_failed', 'bad_json'].includes(error?.code)
        && /password/i.test(error?.message ?? ''))) {
      throw codedError(400, 'La contraseña no cumple la política de seguridad');
    }
    if (authConflict(error)) throw codedError(409, 'El email ya está registrado');
    throw codedError(503, 'No se pudo crear el usuario');
  }

  // Sin transacción real entre Auth y DB: ante un fallo posterior al alta
  // se revierte el usuario Auth (patrón de compensación existente).
  let profile = null;
  try {
    profile = await createUserProfile({
      id: data.user.id,
      client_id: null,
      role: resolved.role,
      display_name: resolved.display_name,
      module_permissions: resolved.module_permissions,
    });
    return toPublicUser(profile, data.user.email ?? resolved.email);
  } catch {
    try {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(data.user.id);
      if (cleanupError) throw cleanupError;
    } catch {
      // Never log provider errors: they may contain request data or credentials.
      console.error('No se pudo revertir el alta Auth tras fallar el perfil; requiere revisión administrativa.');
    }
    throw codedError(503, 'No se pudo crear el perfil de usuario');
  }
}

export async function updateUser(actor, id, body) {
  const target = resolveTarget(await getUserProfileById(id), actor);
  const values = resolvePatch(actor, target, body);

  // Nota: resolvePatch rechaza role=rdx_admin (403) y resolveTarget devuelve
  // 404 para perfiles rdx_admin, por lo que no existen transiciones hacia o
  // desde rdx_admin en este módulo: los cambios laterales conservan grants.
  if (Object.keys(values).length === 0) {
    return toPublicUser(
      target,
      await authEmailById(supabase.auth.admin, target.id, new Map()),
    );
  }

  const updated = await updateUserProfile(target.id, values);
  return toPublicUser(
    updated,
    await authEmailById(supabase.auth.admin, updated.id, new Map()),
  );
}

export async function setUserStatus(actor, id, active) {
  const target = resolveTarget(await getUserProfileById(id), actor);
  const next = resolveStatus(actor, target, active);

  if (next === target.active) {
    return toPublicUser(
      target,
      await authEmailById(supabase.auth.admin, target.id, new Map()),
    );
  }

  const updated = await updateUserProfile(target.id, { active: next });
  return toPublicUser(
    updated,
    await authEmailById(supabase.auth.admin, updated.id, new Map()),
  );
}
