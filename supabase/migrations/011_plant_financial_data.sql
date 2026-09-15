CREATE TABLE public.plant_financial_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL UNIQUE REFERENCES public.plants(id) ON DELETE CASCADE,
    currency text NOT NULL DEFAULT 'BOB',
    baseline_monthly_bill numeric,
    purchase_energy_rate numeric,
    export_energy_rate numeric,
    installation_date date,
    system_investment numeric,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.plant_electricity_bills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
    billing_month date NOT NULL,
    amount numeric,
    consumption_kwh numeric,
    imported_kwh numeric,
    exported_kwh numeric,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (plant_id, billing_month)
);
