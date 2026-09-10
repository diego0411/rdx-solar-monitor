CREATE TABLE public.plant_power_intervals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    interval_start timestamptz NOT NULL,
    timezone text,
    consumption_power_w numeric,
    generation_power_w numeric,
    battery_charge_power_w numeric,
    battery_discharge_power_w numeric,
    grid_import_power_w numeric,
    grid_export_power_w numeric,
    raw_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE (plant_id, interval_start)
);

CREATE INDEX plant_power_intervals_plant_id_idx ON public.plant_power_intervals (plant_id);
CREATE INDEX plant_power_intervals_interval_start_idx ON public.plant_power_intervals (interval_start);
CREATE INDEX plant_power_intervals_plant_id_interval_start_idx ON public.plant_power_intervals (plant_id, interval_start);
