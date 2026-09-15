ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_latest_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_energy_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.energy_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plant_power_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growatt_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.integration_accounts,
    public.plants,
    public.devices,
    public.device_latest_data,
    public.plant_energy_summary,
    public.energy_intervals,
    public.plant_power_intervals,
    public.growatt_accounts
FROM anon, authenticated;
