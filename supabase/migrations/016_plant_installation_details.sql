CREATE TABLE public.plant_installation_details (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL UNIQUE REFERENCES public.plants(id) ON DELETE CASCADE,
    installed_at date,
    panel_manufacturer text,
    panel_model text,
    panel_count integer CHECK (panel_count IS NULL OR panel_count > 0),
    panel_power_w numeric CHECK (panel_power_w IS NULL OR panel_power_w > 0),
    orientation text,
    tilt_degrees numeric CHECK (
        tilt_degrees IS NULL OR (tilt_degrees >= 0 AND tilt_degrees <= 90)
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plant_installation_details ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.plant_installation_details
FROM PUBLIC, anon, authenticated;
