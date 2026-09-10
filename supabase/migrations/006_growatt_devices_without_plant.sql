ALTER TABLE public.devices ALTER COLUMN plant_id DROP NOT NULL;

CREATE UNIQUE INDEX devices_growatt_external_device_id_idx
    ON public.devices (provider, external_device_id)
    WHERE provider = 'growatt' AND external_device_id IS NOT NULL;