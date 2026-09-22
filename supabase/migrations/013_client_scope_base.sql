CREATE TABLE public.clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id uuid REFERENCES public.clients(id),
    role text NOT NULL,
    display_name text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_profiles_role_check
        CHECK (role IN ('rdx_admin', 'client_admin', 'client_user')),
    CONSTRAINT user_profiles_role_client_scope_check
        CHECK (role = 'rdx_admin' OR client_id IS NOT NULL)
);

CREATE TABLE public.client_plants (
    client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, plant_id)
);

CREATE INDEX user_profiles_client_id_idx ON public.user_profiles (client_id);
CREATE INDEX user_profiles_role_idx ON public.user_profiles (role);
CREATE INDEX client_plants_plant_id_idx ON public.client_plants (plant_id);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_plants ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
    public.clients,
    public.user_profiles,
    public.client_plants
FROM PUBLIC, anon, authenticated;