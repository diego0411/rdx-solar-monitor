-- Mantenimiento V1: visitas y actividades (sin evidencias ni recurrencias).

CREATE TABLE public.maintenance_visits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    priority text NOT NULL DEFAULT 'normal',
    status text NOT NULL DEFAULT 'scheduled',
    scheduled_at timestamptz,
    completed_at timestamptz,
    technician_name text,
    general_observations text,
    service_amount numeric(12, 2),
    currency text NOT NULL DEFAULT 'BOB',
    next_maintenance_at timestamptz,
    next_maintenance_notes text,
    created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT maintenance_visits_priority_check
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    CONSTRAINT maintenance_visits_status_check
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    CONSTRAINT maintenance_visits_service_amount_check
        CHECK (service_amount IS NULL OR service_amount >= 0),
    CONSTRAINT maintenance_visits_completed_at_check
        CHECK (
            (status = 'completed' AND completed_at IS NOT NULL)
            OR (status <> 'completed' AND completed_at IS NULL)
        )
);

CREATE TABLE public.maintenance_activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    maintenance_visit_id uuid NOT NULL
        REFERENCES public.maintenance_visits(id) ON DELETE CASCADE,
    device_id uuid REFERENCES public.devices(id) ON DELETE RESTRICT,
    activity_type text NOT NULL DEFAULT 'inspection',
    title text NOT NULL,
    work_performed text,
    findings text,
    actions_taken text,
    observations text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT maintenance_activities_type_check
        CHECK (activity_type IN ('inspection', 'preventive', 'corrective', 'cleaning', 'other'))
);

CREATE INDEX maintenance_visits_plant_id_idx
    ON public.maintenance_visits (plant_id);
CREATE INDEX maintenance_visits_status_idx
    ON public.maintenance_visits (status);
CREATE INDEX maintenance_visits_scheduled_at_idx
    ON public.maintenance_visits (scheduled_at);
CREATE INDEX maintenance_activities_visit_id_idx
    ON public.maintenance_activities (maintenance_visit_id);
CREATE INDEX maintenance_activities_device_id_idx
    ON public.maintenance_activities (device_id);

ALTER TABLE public.maintenance_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_activities ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.maintenance_visits
FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.maintenance_activities
FROM PUBLIC, anon, authenticated;
