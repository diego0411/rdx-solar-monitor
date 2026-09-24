CREATE TABLE public.plant_energy_tariffs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
    effective_from date NOT NULL,
    effective_to date,
    purchase_energy_rate numeric NOT NULL CHECK (purchase_energy_rate >= 0),
    export_energy_rate numeric CHECK (export_energy_rate IS NULL OR export_energy_rate >= 0),
    currency text NOT NULL DEFAULT 'BOB' CHECK (length(trim(currency)) BETWEEN 3 AND 8),
    export_compensation_type text NOT NULL
        CHECK (export_compensation_type IN ('energy_credit', 'monetary', 'none')),
    distributor text,
    tariff_category text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CHECK (export_compensation_type <> 'monetary' OR export_energy_rate IS NOT NULL),
    UNIQUE (plant_id, effective_from)
);

CREATE INDEX plant_energy_tariffs_plant_period_idx
    ON public.plant_energy_tariffs (plant_id, effective_from, effective_to);

CREATE OR REPLACE FUNCTION public.prevent_overlapping_plant_energy_tariffs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.plant_energy_tariffs existing
        WHERE existing.plant_id = NEW.plant_id
          AND existing.id <> NEW.id
          AND existing.effective_from <= COALESCE(NEW.effective_to, 'infinity'::date)
          AND NEW.effective_from <= COALESCE(existing.effective_to, 'infinity'::date)
    ) THEN
        RAISE EXCEPTION 'La vigencia de la tarifa se solapa con otra tarifa de la planta'
            USING ERRCODE = '23P01';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER plant_energy_tariffs_no_overlap
BEFORE INSERT OR UPDATE ON public.plant_energy_tariffs
FOR EACH ROW EXECUTE FUNCTION public.prevent_overlapping_plant_energy_tariffs();

ALTER TABLE public.plant_energy_tariffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.plant_energy_tariffs
FROM PUBLIC, anon, authenticated;
