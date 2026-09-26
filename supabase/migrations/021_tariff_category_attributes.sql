-- Atributos estructurales mínimos para categorías y componentes.
-- Todos los campos nuevos son nullables: no altera filas existentes.
-- Sin cálculo con included_kwh todavía; sin datos.

ALTER TABLE public.energy_tariff_categories
    ADD COLUMN activity_type text,
    ADD COLUMN demand_class text,
    ADD COLUMN voltage_level text,
    ADD CONSTRAINT energy_tariff_categories_demand_class_check
        CHECK (demand_class IS NULL OR demand_class IN ('PD', 'MD', 'GD')),
    ADD CONSTRAINT energy_tariff_categories_voltage_level_check
        CHECK (voltage_level IS NULL OR voltage_level IN ('BT', 'MT', 'AT'));

ALTER TABLE public.energy_tariff_components
    ADD COLUMN included_kwh numeric,
    ADD CONSTRAINT energy_tariff_components_included_kwh_check
        CHECK (included_kwh IS NULL OR included_kwh >= 0);
