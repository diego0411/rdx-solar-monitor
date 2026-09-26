-- Seed mínimo: categoría CRE confirmada para validar el catálogo dinámico.
-- Solo clasificación (sin precios, estructuras ni componentes).
-- Determinista: no inserta duplicados gracias a UNIQUE(distributor_id, code).
-- Falla ruidosamente si la distribuidora CRE no existe.

DO $$
DECLARE
    cre_id uuid;
BEGIN
    SELECT id INTO cre_id
    FROM public.energy_distributors
    WHERE code = 'CRE';

    IF cre_id IS NULL THEN
        RAISE EXCEPTION 'energy_distributors no contiene code = CRE';
    END IF;

    INSERT INTO public.energy_tariff_categories
        (distributor_id, code, name, activity_type, demand_class, voltage_level, active)
    VALUES
        (cre_id, 'D-PD-BT', 'Domiciliaria / Pequeña Demanda / Baja Tensión',
         'Domiciliaria', 'PD', 'BT', true)
    ON CONFLICT (distributor_id, code) DO NOTHING;
END
$$;
