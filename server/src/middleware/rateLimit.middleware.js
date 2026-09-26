import { rateLimit } from 'express-rate-limit';

function tooManyRequests(req, res) {
  return res.status(429).json({
    error: 'Demasiadas solicitudes. Intente nuevamente más tarde.',
  });
}

const baseOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
};

/*
 * Limitador general para /api. Permisivo a propósito: el portal
 * sondea el dashboard cada 60s y varias vistas consultan en
 * paralelo; esto solo frena abuso/DoS básico, no uso legítimo.
 */
export const apiLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 1000,
});

/*
 * Limitador estricto para /api/integrations, donde viven los
 * endpoints manuales y costosos (syncs HYXi/Growatt, refrescos
 * de caché, passthroughs al proveedor). Todos ya exigen
 * rdx_admin; esto frena bucles o tokens comprometidos.
 */
export const sensitiveLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 60,
});
