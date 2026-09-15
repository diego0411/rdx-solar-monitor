ALTER TABLE public.plant_financial_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_electricity_bills ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE
    public.plant_financial_profiles,
    public.plant_electricity_bills
FROM PUBLIC, anon, authenticated;
