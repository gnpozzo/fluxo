-- ==============================================================================
-- FLUXO - MIGRACIÓN DE SEGURIDAD MULTI-INQUILINO & AISLAMIENTO DE DATOS
-- ==============================================================================
-- Este script:
-- 1. Agrega user_id a todas las tablas del dominio con referencia a auth.users(id).
-- 2. Barre y elimina todos los movimientos, consumos, inversiones, ahorros y gastos históricos.
-- 3. Activa Row Level Security (RLS) estricto con políticas basadas en auth.uid().
-- 4. Crea índices para búsquedas de alta velocidad por user_id.
-- 5. Configura un trigger para aprovisionamiento automático de cuentas cuando el usuario se registre (ej: Google OAuth).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. AGREGAR COLUMNA user_id EN TODAS LAS TABLAS
-- ------------------------------------------------------------------------------

-- Cuentas Principales
ALTER TABLE public.cuentas_principales 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Movimientos
ALTER TABLE public.movimientos 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Tarjetas
ALTER TABLE public.tarjetas 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Consumos TC
ALTER TABLE public.consumos_tc 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Ahorro Subcuentas
ALTER TABLE public.ahorro_subcuentas 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Ahorros
ALTER TABLE public.ahorros 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Inversiones
ALTER TABLE public.inversiones_movimientos 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Gastos Compartidos (CC)
ALTER TABLE public.cc_consumos 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Contactos de Cuenta Corriente
ALTER TABLE public.cta_corriente_usuarios 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Categorías (user_id NULL = del sistema, compartidas para todos; user_id NOT NULL = personalizadas)
ALTER TABLE public.categorias 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Bot Sessions
ALTER TABLE public.bot_sessions 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Recordatorios
ALTER TABLE public.recordatorios 
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- ------------------------------------------------------------------------------
-- 2. LIMPIEZA TOTAL DE MOVIMIENTOS Y DATOS HISTÓRICOS (TABLA RASA)
-- ------------------------------------------------------------------------------
-- Barrido completo de movimientos, consumos TC, inversiones, ahorros y gastos compartidos
TRUNCATE TABLE 
  public.consumos_tc, 
  public.movimientos, 
  public.inversiones_movimientos, 
  public.ahorros, 
  public.cc_consumos 
CASCADE;

-- Limpieza de sesiones anteriores de bot
DELETE FROM public.bot_sessions;

-- Limpieza de entidades previas huérfanas o heredadas (tarjetas, subcuentas, recordatorios, cuentas anteriores)
DELETE FROM public.recordatorios;
DELETE FROM public.tarjetas;
DELETE FROM public.ahorro_subcuentas;
DELETE FROM public.cta_corriente_usuarios;
DELETE FROM public.cuentas_principales;

-- Asegurar que los usuarios registrados existentes en auth.users tengan su entorno limpio y provisionado
DO $$
DECLARE
  u RECORD;
  v_cuenta_id UUID;
BEGIN
  FOR u IN SELECT id, raw_user_meta_data FROM auth.users LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cuentas_principales WHERE user_id = u.id) THEN
      v_cuenta_id := gen_random_uuid();
      
      -- Cuenta principal predeterminada
      INSERT INTO public.cuentas_principales (
        id_cuenta_principal,
        nombre,
        moneda_principal,
        es_predeterminada,
        activa,
        user_id,
        modulo_tarjetas_activo,
        modulo_cc_activo,
        modulo_ahorro_activo,
        modulo_inversiones_activo
      ) VALUES (
        v_cuenta_id::text,
        'Personal',
        'ARS',
        true,
        true,
        u.id,
        true,
        true,
        true,
        true
      ) ON CONFLICT DO NOTHING;

      -- Perfil personal en cuenta corriente
      INSERT INTO public.cta_corriente_usuarios (
        id_usuario,
        nombre,
        es_yo,
        id_cuenta_principal,
        user_id
      ) VALUES (
        gen_random_uuid(),
        COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', 'Gastón Pozzo'),
        true,
        v_cuenta_id::text,
        u.id
      ) ON CONFLICT DO NOTHING;

      -- Subcuentas iniciales de ahorro
      INSERT INTO public.ahorro_subcuentas (
        id_subcuenta,
        id_cuenta_principal,
        nombre,
        moneda,
        user_id
      ) VALUES 
        (gen_random_uuid(), v_cuenta_id::text, 'Fondo de Emergencia', 'ARS', u.id),
        (gen_random_uuid(), v_cuenta_id::text, 'Ahorro General', 'ARS', u.id)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RAISE NOTICE 'Base de datos de movimientos barrida y usuarios existentes aprovisionados limpiamente.';
END $$;

-- ------------------------------------------------------------------------------
-- 3. POLÍTICAS DE ROW LEVEL SECURITY (RLS) ESTRICTAS
-- ------------------------------------------------------------------------------

-- Cuentas Principales
ALTER TABLE public.cuentas_principales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.cuentas_principales;
DROP POLICY IF EXISTS "Users can only access their own cuentas_principales" ON public.cuentas_principales;
CREATE POLICY "Users can only access their own cuentas_principales"
  ON public.cuentas_principales FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Movimientos
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.movimientos;
DROP POLICY IF EXISTS "Users can only access their own movimientos" ON public.movimientos;
CREATE POLICY "Users can only access their own movimientos"
  ON public.movimientos FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Tarjetas
ALTER TABLE public.tarjetas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.tarjetas;
DROP POLICY IF EXISTS "Users can only access their own tarjetas" ON public.tarjetas;
CREATE POLICY "Users can only access their own tarjetas"
  ON public.tarjetas FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Consumos TC
ALTER TABLE public.consumos_tc ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.consumos_tc;
DROP POLICY IF EXISTS "Users can only access their own consumos_tc" ON public.consumos_tc;
CREATE POLICY "Users can only access their own consumos_tc"
  ON public.consumos_tc FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Ahorro Subcuentas
ALTER TABLE public.ahorro_subcuentas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.ahorro_subcuentas;
DROP POLICY IF EXISTS "Users can only access their own ahorro_subcuentas" ON public.ahorro_subcuentas;
CREATE POLICY "Users can only access their own ahorro_subcuentas"
  ON public.ahorro_subcuentas FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Ahorros
ALTER TABLE public.ahorros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.ahorros;
DROP POLICY IF EXISTS "Users can only access their own ahorros" ON public.ahorros;
CREATE POLICY "Users can only access their own ahorros"
  ON public.ahorros FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Inversiones
ALTER TABLE public.inversiones_movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.inversiones_movimientos;
DROP POLICY IF EXISTS "Users can only access their own inversiones" ON public.inversiones_movimientos;
CREATE POLICY "Users can only access their own inversiones"
  ON public.inversiones_movimientos FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Gastos Compartidos (CC)
ALTER TABLE public.cc_consumos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.cc_consumos;
DROP POLICY IF EXISTS "Users can only access their own cc_consumos" ON public.cc_consumos;
CREATE POLICY "Users can only access their own cc_consumos"
  ON public.cc_consumos FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Contactos de Cuenta Corriente
ALTER TABLE public.cta_corriente_usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.cta_corriente_usuarios;
DROP POLICY IF EXISTS "Users can only access their own cta_corriente_usuarios" ON public.cta_corriente_usuarios;
CREATE POLICY "Users can only access their own cta_corriente_usuarios"
  ON public.cta_corriente_usuarios FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Categorías (Globales del sistema con user_id IS NULL + Propias con user_id = auth.uid())
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.categorias;
DROP POLICY IF EXISTS "Users can view global or own categories" ON public.categorias;
DROP POLICY IF EXISTS "Users can manage own categories" ON public.categorias;

CREATE POLICY "Users can view global or own categories"
  ON public.categorias FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can manage own categories"
  ON public.categorias FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Recordatorios
ALTER TABLE public.recordatorios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.recordatorios;
DROP POLICY IF EXISTS "Users can only access their own recordatorios" ON public.recordatorios;
CREATE POLICY "Users can only access their own recordatorios"
  ON public.recordatorios FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Cotizaciones (Solo lectura para autenticados)
ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.cotizaciones;
CREATE POLICY "Enable Read for authenticated users on cotizaciones"
  ON public.cotizaciones FOR SELECT
  USING (auth.role() = 'authenticated');

ALTER TABLE public.cotizaciones_dolar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.cotizaciones_dolar;
CREATE POLICY "Enable Read for authenticated users on cotizaciones_dolar"
  ON public.cotizaciones_dolar FOR SELECT
  USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------------------------
-- 4. ÍNDICES DE ALTO RENDIMIENTO POR user_id
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cuentas_principales_user_id ON public.cuentas_principales(user_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_user_id ON public.movimientos(user_id);
CREATE INDEX IF NOT EXISTS idx_tarjetas_user_id ON public.tarjetas(user_id);
CREATE INDEX IF NOT EXISTS idx_consumos_tc_user_id ON public.consumos_tc(user_id);
CREATE INDEX IF NOT EXISTS idx_ahorros_user_id ON public.ahorros(user_id);
CREATE INDEX IF NOT EXISTS idx_ahorro_subcuentas_user_id ON public.ahorro_subcuentas(user_id);
CREATE INDEX IF NOT EXISTS idx_inversiones_user_id ON public.inversiones_movimientos(user_id);
CREATE INDEX IF NOT EXISTS idx_cc_consumos_user_id ON public.cc_consumos(user_id);
CREATE INDEX IF NOT EXISTS idx_cta_corriente_usuarios_user_id ON public.cta_corriente_usuarios(user_id);
CREATE INDEX IF NOT EXISTS idx_categorias_user_id ON public.categorias(user_id);
CREATE INDEX IF NOT EXISTS idx_recordatorios_user_id ON public.recordatorios(user_id);

-- ------------------------------------------------------------------------------
-- 5. TRIGGER DE APROVISIONAMIENTO AUTOMÁTICO PARA NUEVOS USUARIOS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_new_user_environment()
RETURNS TRIGGER AS $$
DECLARE
  v_cuenta_id UUID;
BEGIN
  v_cuenta_id := gen_random_uuid();

  -- 1. Crear Cuenta Principal por Defecto ("Personal")
  INSERT INTO public.cuentas_principales (
    id_cuenta_principal,
    nombre,
    moneda_principal,
    es_predeterminada,
    activa,
    user_id,
    modulo_tarjetas_activo,
    modulo_cc_activo,
    modulo_ahorro_activo,
    modulo_inversiones_activo
  ) VALUES (
    v_cuenta_id::text,
    'Personal',
    'ARS',
    true,
    true,
    new.id,
    true,
    true,
    true,
    true
  ) ON CONFLICT DO NOTHING;

  -- 2. Crear Contacto Principal de Cuenta Corriente ("Yo")
  INSERT INTO public.cta_corriente_usuarios (
    id_usuario,
    nombre,
    es_yo,
    id_cuenta_principal,
    user_id
  ) VALUES (
    gen_random_uuid(),
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Gastón Pozzo'),
    true,
    v_cuenta_id::text,
    new.id
  ) ON CONFLICT DO NOTHING;

  -- 3. Crear Subcuentas de Ahorro Base
  INSERT INTO public.ahorro_subcuentas (
    id_subcuenta,
    id_cuenta_principal,
    nombre,
    moneda,
    user_id
  ) VALUES 
    (gen_random_uuid(), v_cuenta_id::text, 'Fondo de Emergencia', 'ARS', new.id),
    (gen_random_uuid(), v_cuenta_id::text, 'Ahorro General', 'ARS', new.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Asociar el trigger a auth.users
DROP TRIGGER IF EXISTS on_auth_user_provision ON auth.users;
CREATE TRIGGER on_auth_user_provision
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.provision_new_user_environment();
