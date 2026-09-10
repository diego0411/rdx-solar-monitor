import { supabase } from '../config/supabase.js';

export async function requireAuth(req, res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  if (!match) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    req.user = data.user;
  } catch {
    return res.status(401).json({ error: 'No autorizado' });
  }
  return next();
}
