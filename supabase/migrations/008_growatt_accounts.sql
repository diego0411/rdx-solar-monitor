CREATE TABLE public.growatt_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_account_id uuid REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
    external_user_id text,
    username text,
    api_token_encrypted text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.devices
    ADD COLUMN growatt_account_id uuid REFERENCES public.growatt_accounts(id) ON DELETE SET NULL;

CREATE INDEX growatt_accounts_integration_account_id_idx
    ON public.growatt_accounts (integration_account_id);

CREATE INDEX devices_growatt_account_id_idx
    ON public.devices (growatt_account_id);
