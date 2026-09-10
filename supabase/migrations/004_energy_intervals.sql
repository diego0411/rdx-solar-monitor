CREATE TABLE public.energy_intervals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    interval_type smallint NOT NULL CHECK (interval_type IN (1, 2, 3)),
    interval_start timestamptz NOT NULL,
    timezone text,
    generation_kwh numeric,
    consumption_kwh numeric,
    battery_charge_kwh numeric,
    battery_discharge_kwh numeric,
    grid_import_kwh numeric,
    grid_export_kwh numeric,
    raw_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (plant_id, interval_type, interval_start)
);

CREATE INDEX energy_intervals_plant_id_idx ON public.energy_intervals (plant_id);
CREATE INDEX energy_intervals_interval_start_idx ON public.energy_intervals (interval_start);
CREATE INDEX energy_intervals_plant_id_interval_start_idx ON public.energy_intervals (plant_id, interval_start);
