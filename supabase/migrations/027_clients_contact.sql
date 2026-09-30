-- 027_clients_contact.sql
-- Datos de contacto V1 para clientes comerciales (catálogo, sin autorización).
-- Aditiva y segura: solo agrega columnas NULLables, sin backfill, sin
-- NOT NULL, sin DEFAULT, sin UNIQUE, sin triggers, sin tocar Nexora,
-- user_profiles, client_plants ni migraciones 001-026.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS phone text NULL;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email text NULL;
