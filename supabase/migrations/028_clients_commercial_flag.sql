-- 028_clients_commercial_flag.sql
-- Separa el catálogo comercial de la fila legacy Nexora sin rediseñar autorización.
--
-- clients.is_commercial = true  -> pertenece al catálogo comercial (/clients, inventario).
-- clients.is_commercial = false -> ancla legacy de autorización (Nexora), invisible
--   en listados comerciales pero válida para loadProfile, client_plants y usuarios.
--
-- FAIL-SAFE Nexora: 014 no creó un UUID fijo, por eso se identifica por
-- lower(trim(name)) = 'nexora'. Si existen 0 o más de 1 coincidencias la
-- migración aborta con RAISE EXCEPTION y no modifica nada.
-- NO infiere mediante plantas, usuarios ni client_plants.
-- NO modifica active, phone, email, name, client_plants ni user_profiles.
-- NO toca migraciones 001-027.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_commercial boolean NOT NULL DEFAULT true;

DO $$
DECLARE nexora_count integer;
BEGIN
  SELECT count(*) INTO nexora_count
  FROM public.clients
  WHERE lower(btrim(name)) = 'nexora';
  IF nexora_count <> 1 THEN
    RAISE EXCEPTION 'Migración 028 abortada: se esperaba exactamente 1 fila Nexora, encontradas %', nexora_count;
  END IF;
  UPDATE public.clients SET is_commercial = false WHERE lower(btrim(name)) = 'nexora';
END $$;
