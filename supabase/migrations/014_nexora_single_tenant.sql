-- Single-tenant Nexora bootstrap (idempotente).
--
-- El portal opera una única empresa (Nexora). Este script garantiza:
-- 1. Existe exactamente un cliente activo 'Nexora'.
-- 2. Todas las plantas existentes quedan asignadas a Nexora.
--
-- No modifica roles, RLS ni datos de usuarios.

INSERT INTO public.clients (name, active)
SELECT 'Nexora', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.clients WHERE lower(name) = 'nexora'
);

INSERT INTO public.client_plants (client_id, plant_id)
SELECT c.id, p.id
FROM public.clients c
CROSS JOIN public.plants p
WHERE lower(c.name) = 'nexora'
ON CONFLICT (client_id, plant_id) DO NOTHING;
