-- ==============================================================================
-- FLUXO - SCRIPT CONSOLIDADO DE ACTUALIZACIÓN DE ESQUEMA SUPABASE
-- ==============================================================================
-- Este script es 100% seguro e idempotente (IF NOT EXISTS).
-- Se puede ejecutar múltiples veces sin borrar datos existentes.
-- ==============================================================================

-- 1. TABLA: ahorros (Agregar id_subcuenta para vinculación con alcancías)
ALTER TABLE IF EXISTS public.ahorros 
  ADD COLUMN IF NOT EXISTS id_subcuenta TEXT;

CREATE INDEX IF NOT EXISTS idx_ahorros_id_subcuenta 
  ON public.ahorros(id_subcuenta);

-- 2. TABLA: ahorro_subcuentas (Alcancías y Metas de Ahorro)
ALTER TABLE IF EXISTS public.ahorro_subcuentas 
  ADD COLUMN IF NOT EXISTS id_cuenta_principal TEXT REFERENCES public.cuentas_principales(id_cuenta_principal) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meta NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS icono TEXT DEFAULT 'piggy-bank',
  ADD COLUMN IF NOT EXISTS activa BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ahorro_subcuentas_cta 
  ON public.ahorro_subcuentas(id_cuenta_principal);

-- 3. TABLA: inversiones_movimientos (Operaciones de compra/venta)
ALTER TABLE IF EXISTS public.inversiones_movimientos 
  ADD COLUMN IF NOT EXISTS id_cuenta_principal TEXT,
  ADD COLUMN IF NOT EXISTS importe_total_ars NUMERIC,
  ADD COLUMN IF NOT EXISTS precio_compra NUMERIC,
  ADD COLUMN IF NOT EXISTS cantidad_nominales NUMERIC;

CREATE INDEX IF NOT EXISTS idx_inv_mov_cuenta 
  ON public.inversiones_movimientos(id_cuenta_principal);

CREATE INDEX IF NOT EXISTS idx_inv_mov_ticker 
  ON public.inversiones_movimientos(ticker);

-- 4. TABLA: cotizaciones_dolar (Campos de compra y venta explícitos)
ALTER TABLE IF EXISTS public.cotizaciones_dolar 
  ADD COLUMN IF NOT EXISTS compra NUMERIC,
  ADD COLUMN IF NOT EXISTS venta NUMERIC;

-- 5. TABLA: movimientos (Transferencias de ahorro e inversión)
ALTER TABLE IF EXISTS public.movimientos 
  ADD COLUMN IF NOT EXISTS id_transfer_ahorro TEXT,
  ADD COLUMN IF NOT EXISTS id_transfer_inversion TEXT,
  ADD COLUMN IF NOT EXISTS moneda TEXT DEFAULT 'ARS';

CREATE INDEX IF NOT EXISTS idx_mov_transfer_ahorro 
  ON public.movimientos(id_transfer_ahorro);

CREATE INDEX IF NOT EXISTS idx_mov_transfer_inversion 
  ON public.movimientos(id_transfer_inversion);

-- 6. TABLA: tarjetas (Gestión plástica y límites)
ALTER TABLE IF EXISTS public.tarjetas 
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#2563EB',
  ADD COLUMN IF NOT EXISTS limite_ars NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS limite_usd NUMERIC DEFAULT 0;

-- 7. TABLA: consumos_tc (Tarjetas de crédito)
ALTER TABLE IF EXISTS public.consumos_tc 
  ADD COLUMN IF NOT EXISTS imputado_a TEXT;

-- 8. TABLA: cta_corriente_usuarios (Contactos para gastos compartidos)
ALTER TABLE IF EXISTS public.cta_corriente_usuarios 
  ADD COLUMN IF NOT EXISTS es_yo BOOLEAN DEFAULT false;

-- ==============================================================================
-- REFRESCAR CACHÉ DE ESQUEMA DE POSTGREST
-- ==============================================================================
NOTIFY pgrst, 'reload schema';
