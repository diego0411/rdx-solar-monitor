-- Amplía devices_status_check para admitir 'standby' (reposo nocturno Growatt).
-- Producción confirma el CHECK vigente con cinco estados; esta migración solo
-- agrega el sexto sin alterar filas existentes (expand puro).
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_status_check;
ALTER TABLE public.devices ADD CONSTRAINT devices_status_check
    CHECK (status IN ('online', 'offline', 'alarm', 'inactive', 'unknown', 'standby'));
