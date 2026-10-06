-- 034_alarms.sql
-- Historial normalizado de alarmas, Fase 1: modelo + repositorio.
--
-- Migraciones 001-033 congeladas: no se editan. Esta migración solo crea
-- la tabla public.alarms; no toca tablas existentes, no crea funciones ni
-- programaciones. El poller/scheduler (Fase 2) y el backfill quedan fuera.
--
-- Diseño:
-- - Cada fila es un EPISODIO: la misma falla lógica puede reaparecer
--   después de resolverse como un episodio nuevo (activo -> resolved ->
--   nuevo activo). Por eso NO hay UNIQUE permanente sobre la identidad
--   lógica: solo índices UNIQUE PARCIALES sobre status = 'active'.
-- - first_seen_at es nuestra primera observación; started_at es el
--   timestamp del fabricante cuando lo entrega (puede ser NULL: Growatt
--   solo entrega snapshots y HYXi plantAlarmPage hoy responde 404, así que
--   no se asume ID externo, severidad ni timestamps del fabricante).
-- - COALESCE(external_alarm_id, '') en los índices es seguro porque el
--   CHECK prohíbe cadenas vacías o solo-espacios: '' nunca colisiona con
--   un ID real. No se usa ningún UUID mágico.
CREATE TABLE public.alarms (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
    device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
    provider text NOT NULL,
    external_alarm_id text,
    alarm_code text NOT NULL,
    title text NOT NULL,
    description text,
    severity text,
    status text NOT NULL DEFAULT 'active',
    started_at timestamptz,
    resolved_at timestamptz,
    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alarms_provider_check
        CHECK (provider IN ('hyxi', 'growatt')),
    CONSTRAINT alarms_external_alarm_id_check
        CHECK (external_alarm_id IS NULL OR btrim(external_alarm_id) <> ''),
    CONSTRAINT alarms_alarm_code_check
        CHECK (btrim(alarm_code) <> ''),
    CONSTRAINT alarms_title_check
        CHECK (btrim(title) <> ''),
    CONSTRAINT alarms_severity_check
        CHECK (severity IS NULL OR severity IN ('information', 'warning', 'critical')),
    CONSTRAINT alarms_status_check
        CHECK (status IN ('active', 'resolved')),
    CONSTRAINT alarms_active_requires_no_resolution
        CHECK (status <> 'active' OR resolved_at IS NULL),
    CONSTRAINT alarms_resolved_requires_resolution
        CHECK (status <> 'resolved' OR resolved_at IS NOT NULL),
    CONSTRAINT alarms_last_seen_not_before_first_seen
        CHECK (last_seen_at >= first_seen_at)
);

-- Identidad de episodio ACTIVO a nivel dispositivo
-- (Growatt: device_id + alarm_code; HYXi futuro con external id y device
-- también cae aquí). Solo un activo por identidad lógica.
CREATE UNIQUE INDEX alarms_active_device_identity_uidx
    ON public.alarms (provider, device_id, alarm_code, COALESCE(external_alarm_id, ''))
    WHERE status = 'active' AND device_id IS NOT NULL;

-- Identidad de episodio ACTIVO a nivel planta, sin dispositivo
-- (futura alarma HYXi a nivel planta). Solo un activo por identidad lógica.
CREATE UNIQUE INDEX alarms_active_plant_identity_uidx
    ON public.alarms (provider, plant_id, alarm_code, COALESCE(external_alarm_id, ''))
    WHERE status = 'active' AND device_id IS NULL;

CREATE INDEX alarms_status_idx
    ON public.alarms (status);
CREATE INDEX alarms_plant_id_idx
    ON public.alarms (plant_id);
CREATE INDEX alarms_device_id_idx
    ON public.alarms (device_id);
CREATE INDEX alarms_provider_idx
    ON public.alarms (provider);
CREATE INDEX alarms_last_seen_idx
    ON public.alarms (last_seen_at DESC);

ALTER TABLE public.alarms ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.alarms FROM PUBLIC, anon, authenticated;
