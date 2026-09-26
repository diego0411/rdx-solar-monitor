-- Catálogo maestro inicial: CRE R.L. y sus sistemas/áreas de cobertura.
-- Solo distribuidora y áreas. Sin categorías, estructuras, componentes,
-- precios ni resoluciones.

INSERT INTO public.energy_distributors (code, name, country_code, active)
VALUES ('CRE', 'CRE R.L.', 'BO', true);

INSERT INTO public.energy_distribution_areas (distributor_id, code, name, active)
VALUES
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'AREA_INTEGRADA', 'Área Integrada', true),
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'CORDILLERA', 'Cordillera', true),
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'CHARAGUA', 'Charagua', true),
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'EL_ESPINO', 'El Espino', true),
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'VELASCO', 'Velasco', true),
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'GERMAN_BUSCH', 'Germán Busch', true),
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'VALLES_CRUCENOS', 'Valles Cruceños', true),
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'LAS_MISIONES', 'Las Misiones', true),
    ((SELECT id FROM public.energy_distributors WHERE code = 'CRE'), 'CHIQUITOS', 'Chiquitos', true);
