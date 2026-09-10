ALTER TABLE public.device_latest_data
    ADD COLUMN load_power numeric,
    ADD COLUMN grid_import_power numeric,
    ADD COLUMN grid_export_power numeric,
    ADD COLUMN battery_charge_power numeric,
    ADD COLUMN battery_discharge_power numeric;
