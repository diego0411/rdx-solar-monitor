import { supabase } from '../config/supabase.js';
import { elapsedMs, metricsEnabled } from './httpMetrics.middleware.js';

export async function requireAuth(req, res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  // Sub-medición opt-in: se registra también en error, sin exponer el token.
  const started = metricsEnabled() ? process.hrtime.bigint() : null;
  try {
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    req.user = data.user;
  } catch {
    return res.status(401).json({ error: 'No autorizado' });
  } finally {
    if (started !== null) res.locals.auth_ms = elapsedMs(started);
  }
  return next();
}
