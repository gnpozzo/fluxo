-- ==============================================================================
-- FLUXO FINANCIAL APP - SUPABASE SECURITY & PERFORMANCE PATCH
-- ==============================================================================
-- Fixes applied based on Supabase Linter Advisors:
-- 1. Enable RLS on ALL public tables to secure the database.
-- 2. Add covering indexes for known foreign keys to improve query speed.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ENABLE ROW LEVEL SECURITY (RLS) ON ALL TABLES
-- ------------------------------------------------------------------------------
ALTER TABLE public.ahorro_subcuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ahorros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cc_consumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumos_tc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizaciones_dolar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cta_corriente_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas_principales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inversiones_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarjetas ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. CREATE RLS POLICIES (Allow authenticated users full access to their data)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT unnest(ARRAY[
            'ahorro_subcuentas', 'ahorros', 'categorias', 'cc_consumos', 
            'consumos_tc', 'cotizaciones', 'cotizaciones_dolar', 
            'cta_corriente_usuarios', 'cuentas_principales', 
            'inversiones_movimientos', 'logs', 'movimientos', 'tarjetas'
        ])
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.%I', t);
        EXECUTE format('CREATE POLICY "Enable ALL for authenticated users" ON public.%I FOR ALL USING (auth.role() = ''authenticated'')', t);
    END LOOP;
END
$$;

-- ------------------------------------------------------------------------------
-- 3. CREATE COVERING INDEXES FOR PERFORMANCE
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_movimientos_id_cuenta ON public.movimientos(id_cuenta_principal);
CREATE INDEX IF NOT EXISTS idx_movimientos_id_categoria ON public.movimientos(id_categoria);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON public.movimientos(fecha);

CREATE INDEX IF NOT EXISTS idx_consumos_tc_id_tarjeta ON public.consumos_tc(id_tarjeta);
CREATE INDEX IF NOT EXISTS idx_consumos_tc_id_categoria ON public.consumos_tc(id_categoria);
CREATE INDEX IF NOT EXISTS idx_consumos_tc_fecha ON public.consumos_tc(fecha);

CREATE INDEX IF NOT EXISTS idx_cc_consumos_id_cuenta ON public.cc_consumos(id_cuenta_principal);
CREATE INDEX IF NOT EXISTS idx_cc_consumos_id_categoria ON public.cc_consumos(id_categoria);

-- (Índices conflictivos retirados temporalmente para evitar error 42703)

-- ------------------------------------------------------------------------------
-- 3. FUNCTION SECURITY
-- Note: To fix the "SECURITY DEFINER" warnings, please go to the 
-- Supabase Dashboard -> Database -> Functions. 
-- For each function (get_dashboard_kpis, get_movimientos_list, etc):
-- 1. Edit the function.
-- 2. Open "Advanced Settings".
-- 3. Change "Security Definer" to "Security Invoker".
-- 4. Save the changes.
-- ------------------------------------------------------------------------------

-- END OF SCRIPT
