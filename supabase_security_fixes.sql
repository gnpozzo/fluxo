-- ==============================================================================
-- FLUXO FINANCIAL APP - SUPABASE SECURITY & PERFORMANCE PATCH
-- ==============================================================================
-- Fixes applied based on Supabase Linter Advisors:
-- 1. Enable RLS on all public tables and add policies.
-- 2. Convert SECURITY DEFINER to SECURITY INVOKER where appropriate.
-- 3. Set search_path='' for functions to prevent search path injection.
-- 4. Add covering indexes for foreign keys.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ENABLE ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.ahorro_subcuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ahorro_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumos_tc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumos_cc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas_principales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tarjetas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cta_corriente_usuarios ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. CREATE RLS POLICIES (Allow authenticated users full access to their own data)
-- Note: Assuming a single-user or tenant-less structure for now, allowing 
-- authenticated users full access. If multi-tenant, add 'auth.uid() = user_id'.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT unnest(ARRAY[
            'ahorro_subcuentas', 'ahorro_movimientos', 'movimientos', 
            'consumos_tc', 'consumos_cc', 'cuentas_principales', 
            'categorias', 'tarjetas', 'cta_corriente_usuarios'
        ])
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.%I', t);
        EXECUTE format('CREATE POLICY "Enable ALL for authenticated users" ON public.%I FOR ALL USING (auth.role() = ''authenticated'')', t);
    END LOOP;
END
$$;

-- ------------------------------------------------------------------------------
-- 3. FUNCTION SECURITY AND PERFORMANCE FIXES
-- Convert SECURITY DEFINER to SECURITY INVOKER and set search_path
-- ------------------------------------------------------------------------------

-- Update: get_dashboard_kpis
ALTER FUNCTION public.get_dashboard_kpis(uuid, text, text, boolean) 
    SECURITY INVOKER SET search_path = '';

-- Update: get_movimientos_list
ALTER FUNCTION public.get_movimientos_list(uuid, text, text) 
    SECURITY INVOKER SET search_path = '';

-- Update: get_ahorros_dashboard
ALTER FUNCTION public.get_ahorros_dashboard(uuid, text, text) 
    SECURITY INVOKER SET search_path = '';

-- Update: get_consumos_cc_list
ALTER FUNCTION public.get_consumos_cc_list(uuid, text, text) 
    SECURITY INVOKER SET search_path = '';

-- Update: get_consumos_tc_list
ALTER FUNCTION public.get_consumos_tc_list(uuid, text, text) 
    SECURITY INVOKER SET search_path = '';

-- ------------------------------------------------------------------------------
-- 4. ADD FOREIGN KEY INDEXES FOR PERFORMANCE
-- ------------------------------------------------------------------------------
-- Movimientos
CREATE INDEX IF NOT EXISTS idx_movimientos_cuenta ON public.movimientos (id_cuenta_principal);
CREATE INDEX IF NOT EXISTS idx_movimientos_categoria ON public.movimientos (id_categoria);

-- Consumos TC
CREATE INDEX IF NOT EXISTS idx_consumos_tc_cuenta ON public.consumos_tc (id_cuenta_principal);
CREATE INDEX IF NOT EXISTS idx_consumos_tc_tarjeta ON public.consumos_tc (id_tarjeta);
CREATE INDEX IF NOT EXISTS idx_consumos_tc_categoria ON public.consumos_tc (id_categoria);

-- Consumos CC
CREATE INDEX IF NOT EXISTS idx_consumos_cc_cuenta ON public.consumos_cc (id_cuenta_principal);
CREATE INDEX IF NOT EXISTS idx_consumos_cc_usuario ON public.consumos_cc (id_usuario);
CREATE INDEX IF NOT EXISTS idx_consumos_cc_categoria ON public.consumos_cc (id_categoria);

-- Ahorros
CREATE INDEX IF NOT EXISTS idx_ahorro_subcuentas_cuenta ON public.ahorro_subcuentas (id_cuenta_principal);
CREATE INDEX IF NOT EXISTS idx_ahorro_movimientos_cuenta ON public.ahorro_movimientos (id_cuenta_principal);
CREATE INDEX IF NOT EXISTS idx_ahorro_movimientos_subcuenta ON public.ahorro_movimientos (id_subcuenta);

-- Tarjetas
CREATE INDEX IF NOT EXISTS idx_tarjetas_cuenta ON public.tarjetas (id_cuenta_principal);

-- Categorias
-- If categories have parent relationships, index them:
-- CREATE INDEX IF NOT EXISTS idx_categorias_parent ON public.categorias (id_padre);

-- ------------------------------------------------------------------------------
-- 5. REVOKE PUBLIC EXECUTE FROM FUNCTIONS (Hardening)
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(uuid, text, text, boolean) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_movimientos_list(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_movimientos_list(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_ahorros_dashboard(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_ahorros_dashboard(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_consumos_cc_list(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_consumos_cc_list(uuid, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_consumos_tc_list(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_consumos_tc_list(uuid, text, text) TO authenticated;

-- END OF SCRIPT
