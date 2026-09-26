import { supabase } from '../config/supabase.js';

export function getHealth(req, res) {
  res.json({ status: 'ok' });
}

export async function getDatabaseHealth(req, res) {
  try {
    const results = await Promise.all(
      ['integration_accounts', 'plants', 'devices'].map((table) =>
        supabase.from(table).select('id', { count: 'exact', head: true }),
      ),
    );

    if (results.some(({ error }) => error)) {
      return res.status(503).json({
        status: 'error',
        database: 'unavailable',
      });
    }

    return res.json({
      status: 'ok',
      database: 'connected',
    });
  } catch {
    return res.status(503).json({
      status: 'error',
      database: 'unavailable',
    });
  }
}
