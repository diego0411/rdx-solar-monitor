-- 029_user_plants.sql
-- Desacopla el scope de plantas de Usuarios respecto de Clientes.
--
-- user_plants(user_id, plant_id) sustituye a client_plants en autorización:
-- el acceso futuro es directo usuario <-> plantas, sin pasar por clientes.
-- rdx_admin mantiene alcance global sin filas user_plants.
--
-- El backfill preserva exactamente la autorización existente (incluye usuarios
-- y plantas activos/inactivos): no reinterpreta, solo copia.
-- El gate aborta si legacy y nuevo difieren en cualquier dirección.
-- Después se relaja únicamente el CHECK que obligaba client_id NOT NULL
-- a roles no-rdx_admin, para que usuarios NUEVOS puedan existir sin cliente.
--
-- NO elimina user_profiles.client_id, su FK, client_plants, Nexora, clients
-- ni migraciones 001-028.
CREATE TABLE public.user_plants (
    user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, plant_id)
);
CREATE INDEX user_plants_plant_id_idx ON public.user_plants (plant_id);
ALTER TABLE public.user_plants ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.user_plants FROM PUBLIC, anon, authenticated;

INSERT INTO public.user_plants (user_id, plant_id)
SELECT up.id, cp.plant_id
FROM public.user_profiles up
JOIN public.client_plants cp ON cp.client_id = up.client_id
WHERE up.role <> 'rdx_admin'
ON CONFLICT (user_id, plant_id) DO NOTHING;

DO $$
DECLARE legacy_count integer;
DECLARE migrated_count integer;
BEGIN
  SELECT count(*) INTO legacy_count
  FROM public.user_profiles up
  JOIN public.client_plants cp ON cp.client_id = up.client_id
  WHERE up.role <> 'rdx_admin';
  SELECT count(*) INTO migrated_count FROM public.user_plants;
  IF legacy_count <> migrated_count THEN
    RAISE EXCEPTION 'Migración 029 abortada: scope legacy (%) difiere de user_plants (%)', legacy_count, migrated_count;
  END IF;
END $$;

ALTER TABLE public.user_profiles DROP CONSTRAINT user_profiles_role_client_scope_check;
