import { supabase } from '../config/supabase.js';
import {
  listUserProfiles,
  getUserProfileById,
  createUserProfile,
  updateUserProfile,
  clientExists,
} from '../repositories/userProfiles.repository.js';
import { listActiveClients } from '../repositories/clients.repository.js';

const MANAGED_ROLES = ['client_admin', 'client_user'];
const PATCH_FIELDS = ['display_name', 'role'];

function codedError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/*
 * Un perfil es gestionable por este módulo solo si es cliente
 * (nunca rdx_admin) y pertenece a un client_id concreto.
 */
export function isManagedProfile(profile) {
  return !!profile
    && MANAGED_ROLES.includes(profile.role)
    && profile.client_id !== null
    && profile.client_id !== undefined;
}

export function visibleProfiles(profiles, actor) {
  if (actor.role === 'rdx_admin') {
    return profiles.filter(isManagedProfile);
  }

  return profiles.filter(
    profile =>
      isManagedProfile(profile)
      && profile.client_id === actor.client_id,
  );
}

/*
 * Resuelve el perfil objetivo o lanza 404 si no existe,
 * no es gestionable o pertenece a otro cliente.
 */
export function resolveTarget(target, actor) {
  if (!isManagedProfile(target)) {
    throw codedError(404, 'Usuario no encontrado');
  }

  if (
    actor.role !== 'rdx_admin'
    && target.client_id !== actor.client_id
  ) {
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
 * Decide role/client_id efectivos de creación.
 * client_admin NUNCA puede salir de su propio client_id.
 * rdx_admin puede omitir client_id: se resuelve server-side
 * al único cliente activo (single-tenant Nexora).
 */
export function resolveCreate(actor, body) {
  if (!['rdx_admin', 'client_admin'].includes(actor?.role)) {
    throw codedError(403, 'No tienes permiso para crear usuarios');
  }
  const { email, role, client_id } = body ?? {};
  const display_name = body?.name ?? body?.display_name;

  if (!validEmail(email)) throw codedError(400, 'email inválido');

  if (actor.role === 'rdx_admin') {
    if (!MANAGED_ROLES.includes(role)) {
      throw codedError(403, 'No se puede crear ese rol');
    }
    if (client_id !== undefined && client_id !== null) {
      if (typeof client_id !== 'string' || client_id.trim() === '') {
        throw codedError(400, 'client_id inválido');
      }
      return {
        email: email.trim(),
        display_name: cleanDisplayName(display_name),
        role,
        client_id: client_id.trim(),
      };
    }
    return {
      email: email.trim(),
      display_name: cleanDisplayName(display_name),
      role,
      client_id: undefined,
    };
  }

  if (role !== undefined && !MANAGED_ROLES.includes(role)) {
    throw codedError(403, 'No se puede crear ese rol');
  }

  return {
    email: email.trim(),
    display_name: cleanDisplayName(display_name),
    role: role ?? 'client_user',
    client_id: actor.client_id,
  };
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
    client_id: profile.client_id,
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

/*
 * Resuelve server-side el único cliente activo (single-tenant Nexora).
 * Falla si no hay exactamente uno: nunca se adivina ni se usa frontend.
 */
export async function resolveSingleActiveClient() {
  const clients = await listActiveClients();

  if (clients.length !== 1) {
    throw codedError(400, 'No se pudo resolver el cliente');
  }

  return clients[0].id;
}

export async function createUser(actor, body) {
  const resolved = resolveCreate(actor, body);
  const password = body?.password;
  // Supabase applies the project's current password policy as well.
  if (typeof password !== 'string' || password.length < 6 || !password.trim()) {
    throw codedError(400, 'La contraseña debe tener al menos 6 caracteres');
  }

  if (resolved.client_id === undefined) {
    resolved.client_id = await resolveSingleActiveClient();
  }

  if (!(await clientExists(resolved.client_id))) {
    throw codedError(400, 'client_id inexistente');
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

  try {
    const profile = await createUserProfile({
      id: data.user.id,
      client_id: resolved.client_id,
      role: resolved.role,
      display_name: resolved.display_name,
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
