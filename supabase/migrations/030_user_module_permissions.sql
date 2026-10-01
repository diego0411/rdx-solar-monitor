-- 030_user_module_permissions.sql
-- Permisos de acceso por módulo para client_user.
--
-- module_permissions es text[] y solo admite el catálogo canónico:
-- dashboard, plants, devices, maintenance, inventory, reports.
-- reports queda reservado (sin módulo funcional todavía): nunca se otorga
-- por backfill ni se muestra en frontend hasta que exista.
--
-- Semántica: rdx_admin y client_admin hacen bypass por rol (valor irrelevante).
-- client_user requiere grant explícito por módulo.
-- El permiso controla ACCESO al módulo, nunca autoridad de escritura
-- (los requireRoles/writer checks existentes siguen mandando).
--
-- Orden sin ventana de bloqueo: columna -> backfill -> CHECK.
-- El backfill otorga los 5 módulos actuales a todos los client_* existentes
-- para que nadie pierda acceso. rdx_admin permanece '{}'.
--
-- NO toca user_plants, client_plants, user_profiles.client_id, Nexora,
-- clients ni migraciones 001-029.
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS module_permissions text[] NOT NULL DEFAULT '{}';

UPDATE public.user_profiles
SET module_permissions = ARRAY['dashboard', 'plants', 'devices', 'maintenance', 'inventory']
WHERE role IN ('client_admin', 'client_user')
  AND (module_permissions IS NULL OR module_permissions = '{}');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_module_permissions_check'
  ) THEN
    ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_module_permissions_check
      CHECK (module_permissions <@ ARRAY['dashboard', 'plants', 'devices', 'maintenance', 'inventory', 'reports']);
  END IF;
END $$;
