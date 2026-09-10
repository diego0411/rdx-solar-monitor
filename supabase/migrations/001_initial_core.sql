CREATE TABLE public.integration_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    name text NOT NULL,
    external_account_id text,
    active boolean NOT NULL DEFAULT true,
    last_sync_at timestamptz,
    last_sync_status text,
    last_error text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT integration_accounts_provider_check
        CHECK (provider IN ('hyxi', 'growatt'))
);

CREATE TABLE public.plants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_account_id uuid NOT NULL REFERENCES public.integration_accounts(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    external_plant_id text NOT NULL,
    name text NOT NULL,
    plant_type text,
    status text NOT NULL DEFAULT 'unknown',
    capacity_kwp numeric,
    timezone text,
    latitude numeric,
    longitude numeric,
    address text,
    external_updated_at timestamptz,
    last_data_at timestamptz,
    last_synced_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT plants_provider_check
        CHECK (provider IN ('hyxi', 'growatt')),
    CONSTRAINT plants_status_check
        CHECK (status IN ('online', 'offline', 'alarm', 'inactive', 'unknown')),
    CONSTRAINT plants_integration_account_provider_external_plant_unique
        UNIQUE (integration_account_id, provider, external_plant_id)
);

CREATE INDEX plants_integration_account_id_idx ON public.plants (integration_account_id);
CREATE INDEX plants_provider_idx ON public.plants (provider);
CREATE INDEX plants_status_idx ON public.plants (status);
CREATE INDEX plants_active_idx ON public.plants (active);

CREATE TABLE public.devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE RESTRICT,
    provider text NOT NULL,
    external_device_id text,
    serial_number text NOT NULL,
    name text,
    model text,
    device_type text,
    status text NOT NULL DEFAULT 'unknown',
    rated_power_w numeric,
    rated_voltage_v numeric,
    hardware_version text,
    software_version text,
    parent_serial_number text,
    pv_strings integer,
    battery_capacity_kwh numeric,
    last_data_at timestamptz,
    last_synced_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT devices_provider_check
        CHECK (provider IN ('hyxi', 'growatt')),
    CONSTRAINT devices_status_check
        CHECK (status IN ('online', 'offline', 'alarm', 'inactive', 'unknown')),
    CONSTRAINT devices_plant_serial_number_unique
        UNIQUE (plant_id, serial_number)
);

CREATE INDEX devices_plant_id_idx ON public.devices (plant_id);
CREATE INDEX devices_provider_idx ON public.devices (provider);
CREATE INDEX devices_status_idx ON public.devices (status);
CREATE INDEX devices_serial_number_idx ON public.devices (serial_number);
CREATE INDEX devices_active_idx ON public.devices (active);
