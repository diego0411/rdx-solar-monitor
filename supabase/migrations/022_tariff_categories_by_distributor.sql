-- Las categorías tarifarias pertenecen a la distribuidora, no al área.
-- Fuente regulatoria: una única estructura tarifaria por empresa distribuidora;
-- las áreas/sistemas quedan como información operativa/geográfica.
-- Seguro porque energy_tariff_categories no tiene filas (sin seeds en
-- migraciones ni código dependiente): el backfill es no-op y el SET NOT NULL
-- fallaría ruidosamente si existiera alguna fila inesperada sin mapeo.

ALTER TABLE public.energy_tariff_categories
    ADD COLUMN distributor_id uuid
    REFERENCES public.energy_distributors(id) ON DELETE RESTRICT;

UPDATE public.energy_tariff_categories categories
SET distributor_id = areas.distributor_id
FROM public.energy_distribution_areas areas
WHERE areas.id = categories.distribution_area_id;

ALTER TABLE public.energy_tariff_categories
    ALTER COLUMN distributor_id SET NOT NULL,
    DROP CONSTRAINT energy_tariff_categories_distribution_area_id_fkey,
    DROP CONSTRAINT energy_tariff_categories_area_code_unique,
    DROP COLUMN distribution_area_id,
    ADD CONSTRAINT energy_tariff_categories_distributor_code_unique
        UNIQUE (distributor_id, code);

CREATE INDEX energy_tariff_categories_distributor_id_idx
    ON public.energy_tariff_categories (distributor_id);
