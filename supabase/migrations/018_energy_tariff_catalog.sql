-- Catálogo tarifario regulado de Bolivia (solo estructura, sin datos).
-- Las filas existentes de plant_energy_tariffs siguen funcionando como
-- tarifas manuales cuando tariff_structure_id IS NULL.

CREATE TABLE public.energy_distributors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    country_code text NOT NULL DEFAULT 'BO',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.energy_distribution_areas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    distributor_id uuid NOT NULL REFERENCES public.energy_distributors(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT energy_distribution_areas_distributor_code_unique
        UNIQUE (distributor_id, code)
);

CREATE TABLE public.energy_tariff_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    distribution_area_id uuid NOT NULL REFERENCES public.energy_distribution_areas(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT energy_tariff_categories_area_code_unique
        UNIQUE (distribution_area_id, code)
);

CREATE TABLE public.energy_tariff_structures (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_category_id uuid NOT NULL REFERENCES public.energy_tariff_categories(id) ON DELETE CASCADE,
    effective_from date NOT NULL,
    effective_to date,
    currency text NOT NULL DEFAULT 'BOB',
    resolution_number text,
    source_url text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT energy_tariff_structures_period_check
        CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE public.energy_tariff_components (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tariff_structure_id uuid NOT NULL REFERENCES public.energy_tariff_structures(id) ON DELETE CASCADE,
    component_type text NOT NULL
        CONSTRAINT energy_tariff_components_type_check
        CHECK (component_type IN ('fixed', 'energy', 'power')),
    unit text NOT NULL,
    min_value numeric,
    max_value numeric,
    rate numeric NOT NULL CHECK (rate >= 0),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT energy_tariff_components_range_check
        CHECK (max_value IS NULL OR min_value IS NULL OR max_value >= min_value)
);

ALTER TABLE public.plant_energy_tariffs
    ADD COLUMN tariff_structure_id uuid
    REFERENCES public.energy_tariff_structures(id) ON DELETE SET NULL;

CREATE INDEX energy_distribution_areas_distributor_id_idx
    ON public.energy_distribution_areas (distributor_id);
CREATE INDEX energy_tariff_categories_area_id_idx
    ON public.energy_tariff_categories (distribution_area_id);
CREATE INDEX energy_tariff_structures_category_period_idx
    ON public.energy_tariff_structures (tariff_category_id, effective_from, effective_to);
CREATE INDEX energy_tariff_components_structure_id_idx
    ON public.energy_tariff_components (tariff_structure_id);

ALTER TABLE public.energy_distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_distribution_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_tariff_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_tariff_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_tariff_components ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.energy_distributors
FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.energy_distribution_areas
FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.energy_tariff_categories
FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.energy_tariff_structures
FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.energy_tariff_components
FROM PUBLIC, anon, authenticated;
