-- Protección del histórico tarifario: las estructuras oficiales y sus
-- componentes no deben desaparecer por un DELETE en cascada desde un padre.
-- El borrado de una estructura con componentes, o de un padre con hijos,
-- queda bloqueado (RESTRICT); la desactivación se hace con active = false.
-- plant_energy_tariffs.tariff_structure_id conserva ON DELETE SET NULL:
-- la tarifa manual de planta sobrevive y vuelve a modo manual.
-- Sin seeds: no existe en el repositorio fuente oficial que respalde
-- códigos/nombres de distribuidoras y áreas (el array del frontend y los
-- fixtures de tests no son fuente oficial). Se insertarán cuando exista.

ALTER TABLE public.energy_tariff_structures
    ADD COLUMN active boolean NOT NULL DEFAULT true;

ALTER TABLE public.energy_distribution_areas
    DROP CONSTRAINT energy_distribution_areas_distributor_id_fkey,
    ADD CONSTRAINT energy_distribution_areas_distributor_id_fkey
    FOREIGN KEY (distributor_id)
    REFERENCES public.energy_distributors(id) ON DELETE RESTRICT;

ALTER TABLE public.energy_tariff_categories
    DROP CONSTRAINT energy_tariff_categories_distribution_area_id_fkey,
    ADD CONSTRAINT energy_tariff_categories_distribution_area_id_fkey
    FOREIGN KEY (distribution_area_id)
    REFERENCES public.energy_distribution_areas(id) ON DELETE RESTRICT;

ALTER TABLE public.energy_tariff_structures
    DROP CONSTRAINT energy_tariff_structures_tariff_category_id_fkey,
    ADD CONSTRAINT energy_tariff_structures_tariff_category_id_fkey
    FOREIGN KEY (tariff_category_id)
    REFERENCES public.energy_tariff_categories(id) ON DELETE RESTRICT;

ALTER TABLE public.energy_tariff_components
    DROP CONSTRAINT energy_tariff_components_tariff_structure_id_fkey,
    ADD CONSTRAINT energy_tariff_components_tariff_structure_id_fkey
    FOREIGN KEY (tariff_structure_id)
    REFERENCES public.energy_tariff_structures(id) ON DELETE RESTRICT;
