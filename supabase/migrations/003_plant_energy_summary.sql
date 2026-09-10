CREATE TABLE public.plant_energy_summary (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL UNIQUE REFERENCES public.plants(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    today_generation_kwh numeric,
    month_generation_kwh numeric,
    year_generation_kwh numeric,
    total_generation_kwh numeric,
    today_consumption_kwh numeric,
    month_consumption_kwh numeric,
    year_consumption_kwh numeric,
    total_consumption_kwh numeric,
    last_synced_at timestamptz,
    raw_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
