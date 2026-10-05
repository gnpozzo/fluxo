-- Non-destructive isolation and transaction infrastructure.
BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fluxo_runtime') THEN CREATE ROLE fluxo_runtime NOLOGIN NOINHERIT; END IF; END $$;
GRANT authenticated TO fluxo_runtime;
CREATE SCHEMA IF NOT EXISTS fluxo_private;
REVOKE ALL ON SCHEMA fluxo_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS fluxo_private.requests (user_id uuid NOT NULL,endpoint text NOT NULL,request_key text NOT NULL,request_hash text NOT NULL,status integer NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,endpoint,request_key));
ALTER TABLE public.ahorro_subcuentas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own ahorro_subcuentas" ON public.ahorro_subcuentas;
CREATE POLICY owner_access ON public.ahorro_subcuentas FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.ahorros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own ahorros" ON public.ahorros;
CREATE POLICY owner_access ON public.ahorros FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.bot_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for service role" ON public.bot_sessions;
CREATE POLICY owner_access ON public.bot_sessions FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own categories" ON public.categorias;
DROP POLICY IF EXISTS "Users can view global or own categories" ON public.categorias;
CREATE POLICY owner_access ON public.categorias FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY global_read ON public.categorias FOR SELECT TO authenticated USING(user_id IS NULL);
ALTER TABLE public.cc_consumos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own cc_consumos" ON public.cc_consumos;
CREATE POLICY owner_access ON public.cc_consumos FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.consumos_tc ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own consumos_tc" ON public.consumos_tc;
CREATE POLICY owner_access ON public.consumos_tc FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable Read for authenticated users on cotizaciones" ON public.cotizaciones;
CREATE POLICY market_read ON public.cotizaciones FOR SELECT TO authenticated USING(true);
ALTER TABLE public.cotizaciones_dolar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable Read for authenticated users on cotizaciones_dolar" ON public.cotizaciones_dolar;
CREATE POLICY market_read ON public.cotizaciones_dolar FOR SELECT TO authenticated USING(true);
ALTER TABLE public.cta_corriente_usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own cta_corriente_usuarios" ON public.cta_corriente_usuarios;
CREATE POLICY owner_access ON public.cta_corriente_usuarios FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.cuentas_principales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own cuentas_principales" ON public.cuentas_principales;
CREATE POLICY owner_access ON public.cuentas_principales FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.inversiones_movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own inversiones" ON public.inversiones_movimientos;
CREATE POLICY owner_access ON public.inversiones_movimientos FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.logs;
CREATE POLICY payment_state_owner ON public.logs FOR ALL TO authenticated USING(funcion='ESTADO_PAGOS' AND mensaje=auth.uid()::text) WITH CHECK(funcion='ESTADO_PAGOS' AND mensaje=auth.uid()::text);
ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own movimientos" ON public.movimientos;
CREATE POLICY owner_access ON public.movimientos FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.perfiles_usuario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "perfiles_usuario_all" ON public.perfiles_usuario;
CREATE POLICY owner_access ON public.perfiles_usuario FOR ALL TO authenticated USING(id=auth.uid()) WITH CHECK(id=auth.uid());
ALTER TABLE public.recordatorios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable ALL for service role" ON public.recordatorios;
DROP POLICY IF EXISTS "Users can only access their own recordatorios" ON public.recordatorios;
CREATE POLICY owner_access ON public.recordatorios FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
ALTER TABLE public.tarjetas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can only access their own tarjetas" ON public.tarjetas;
CREATE POLICY owner_access ON public.tarjetas FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_id_cuenta text, p_fecha_inicio date, p_fecha_fin date)
 RETURNS TABLE(tipo_mov text, subtotal numeric)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT tipo_mov, SUM(importe) AS subtotal
  FROM movimientos
  WHERE id_cuenta_principal = p_id_cuenta
    AND fecha BETWEEN p_fecha_inicio AND p_fecha_fin
    AND id_transfer_ahorro    IS NULL
    AND id_transfer_inversion IS NULL
  GROUP BY tipo_mov;
$function$
;
ALTER FUNCTION public.get_dashboard_kpis(text,date,date) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_ajuste_cc(p_id_cuenta text, p_fecha_inicio date, p_fecha_fin date)
 RETURNS TABLE(ajuste_neto_cc numeric)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT SUM(
    CASE
      WHEN pagador = 'YO'   THEN  (importe * (100 - porcentaje_imputado)) / 100
      WHEN pagador = 'OTRO' THEN -(importe * porcentaje_imputado) / 100
      ELSE 0
    END
  ) AS ajuste_neto_cc
  FROM cc_consumos
  WHERE id_cuenta_principal = p_id_cuenta
    AND fecha BETWEEN p_fecha_inicio AND p_fecha_fin;
$function$
;
ALTER FUNCTION public.get_ajuste_cc(text,date,date) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_ajuste_tc(p_id_cuenta text, p_fecha_inicio date, p_fecha_fin date)
 RETURNS TABLE(total_cuotas_mes numeric, total_imputado_externo numeric)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT
    SUM(tc.importe) AS total_cuotas_mes,
    SUM(CASE WHEN m.id_movimiento IS NOT NULL THEN tc.importe ELSE 0 END) AS total_imputado_externo
  FROM consumos_tc AS tc
  JOIN tarjetas AS t ON tc.id_tarjeta = t.id_tarjeta
  LEFT JOIN movimientos AS m
    ON tc.id_consumo_tarjeta = m.id_consumo_tarjeta_origen
    AND m.id_cuenta_principal <> p_id_cuenta
  WHERE t.id_cuenta_principal = p_id_cuenta
    AND tc.fecha BETWEEN p_fecha_inicio AND p_fecha_fin;
$function$
;
ALTER FUNCTION public.get_ajuste_tc(text,date,date) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_movimientos_list(p_id_cuenta text, p_fecha_inicio date, p_fecha_fin date, p_limit integer DEFAULT 500)
 RETURNS TABLE(id_movimiento text, fecha date, tipo_mov text, descripcion text, importe numeric, moneda text, medio_pago text, categoria_nombre text, recur_group_id text, split_group_id text, split_rol text, id_consumo_tarjeta_origen text, id_transfer_ahorro text, id_transfer_inversion text)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT
    m.id_movimiento,
    m.fecha,
    m.tipo_mov,
    m.descripcion,
    m.importe,
    m.moneda,
    m.medio_pago,
    c.nombre AS categoria_nombre,
    m.recur_group_id,
    m.split_group_id,
    m.split_rol,
    m.id_consumo_tarjeta_origen,
    m.id_transfer_ahorro,
    m.id_transfer_inversion
  FROM movimientos AS m
  LEFT JOIN categorias AS c ON m.id_categoria = c.id_categoria
  WHERE m.id_cuenta_principal = p_id_cuenta
    AND m.fecha BETWEEN p_fecha_inicio AND p_fecha_fin
  ORDER BY m.fecha DESC, m.created_at DESC
  LIMIT p_limit;
$function$
;
ALTER FUNCTION public.get_movimientos_list(text,date,date,integer) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_split_total(p_split_group_id text)
 RETURNS TABLE(importe_total numeric)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT SUM(importe) AS importe_total
  FROM movimientos
  WHERE split_group_id = p_split_group_id;
$function$
;
ALTER FUNCTION public.get_split_total(text) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_consumo_tc_for_edit(p_consumo_id text)
 RETURNS TABLE(id_consumo_tarjeta text, id_tarjeta text, id_categoria text, fecha date, descripcion text, importe numeric, cuota_actual integer, cuota_total integer, recur_group_id text, id_movimiento_imputado text)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT
    tc.id_consumo_tarjeta,
    tc.id_tarjeta,
    tc.id_categoria,
    tc.fecha,
    tc.descripcion,
    tc.importe,
    tc.cuota_actual,
    tc.cuota_total,
    tc.recur_group_id,
    m.id_movimiento AS id_movimiento_imputado
  FROM consumos_tc AS tc
  LEFT JOIN movimientos AS m ON tc.id_consumo_tarjeta = m.id_consumo_tarjeta_origen
  WHERE tc.id_consumo_tarjeta = p_consumo_id
  LIMIT 1;
$function$
;
ALTER FUNCTION public.get_consumo_tc_for_edit(text) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_consumos_cc_list(p_id_cuenta text, p_fecha_inicio date, p_fecha_fin date)
 RETURNS TABLE(id_cc_consumo text, fecha date, descripcion text, importe numeric, pagador text, porcentaje_imputado numeric, recur_group_id text, nro_cuota integer, total_cuotas integer, categoria_nombre text)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT
    cc.id_cc_consumo,
    cc.fecha,
    cc.descripcion,
    cc.importe,
    cc.pagador,
    cc.porcentaje_imputado,
    cc.recur_group_id,
    cc.nro_cuota,
    cc.total_cuotas,
    cat.nombre AS categoria_nombre
  FROM cc_consumos AS cc
  LEFT JOIN categorias AS cat ON cc.id_categoria = cat.id_categoria
  WHERE cc.id_cuenta_principal = p_id_cuenta
    AND cc.fecha BETWEEN p_fecha_inicio AND p_fecha_fin
  ORDER BY cc.fecha DESC, cc.created_at DESC;
$function$
;
ALTER FUNCTION public.get_consumos_cc_list(text,date,date) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_ahorros_kpis(p_id_cuenta text)
 RETURNS TABLE(moneda text, saldo numeric)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT a.moneda,
    SUM(CASE WHEN a.tipo_transfer = 'DEPOSITO' THEN  a.importe
             WHEN a.tipo_transfer = 'RETIRO'   THEN -a.importe
             ELSE 0 END) AS saldo
  FROM ahorros AS a
  JOIN movimientos AS m ON a.id_movimiento_origen = m.id_movimiento
  WHERE m.id_cuenta_principal = p_id_cuenta
  GROUP BY a.moneda;
$function$
;
ALTER FUNCTION public.get_ahorros_kpis(text) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_ahorros_list(p_id_cuenta text, p_fecha_inicio date, p_fecha_fin date)
 RETURNS TABLE(id_ahorro text, id_movimiento_origen text, fecha date, tipo_transfer text, moneda text, importe numeric, descripcion text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT
    a.id_ahorro,
    a.id_movimiento_origen,
    a.fecha,
    a.tipo_transfer,
    a.moneda,
    a.importe,
    a.descripcion,
    a.created_at
  FROM ahorros AS a
  JOIN movimientos AS m ON a.id_movimiento_origen = m.id_movimiento
  WHERE m.id_cuenta_principal = p_id_cuenta
    AND a.fecha BETWEEN p_fecha_inicio AND p_fecha_fin
  ORDER BY a.fecha DESC, a.created_at DESC;
$function$
;
ALTER FUNCTION public.get_ahorros_list(text,date,date) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_inversiones_movimientos(p_id_cuenta text)
 RETURNS TABLE(ticker text, tipo_operacion text, moneda text, cantidad_nominales numeric, importe_total_ars numeric)
 LANGUAGE sql
 STABLE SECURITY INVOKER
AS $function$
  SELECT
    im.ticker,
    im.tipo_operacion,
    im.moneda,
    im.cantidad_nominales,
    im.importe_total_ars
  FROM inversiones_movimientos AS im
  JOIN movimientos AS m ON im.id_movimiento_origen = m.id_movimiento
  WHERE m.id_cuenta_principal = p_id_cuenta;
$function$
;
ALTER FUNCTION public.get_inversiones_movimientos(text) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.get_consumos_tc_list(p_id_cuenta text, p_fecha_inicio date, p_fecha_fin date)
 RETURNS TABLE(id_consumo_tarjeta text, id_tarjeta text, fecha date, descripcion text, importe numeric, moneda text, cuota_actual integer, cuota_total integer, recur_group_id text, tarjeta_nombre text, categoria_nombre text, id_movimiento_imputado text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    tc.id_consumo_tarjeta,
    tc.id_tarjeta,
    tc.fecha,
    tc.descripcion,
    tc.importe,
    COALESCE(tc.moneda, 'ARS') AS moneda,
    tc.cuota_actual,
    tc.cuota_total,
    tc.recur_group_id,
    t.nombre  AS tarjeta_nombre,
    cat.nombre AS categoria_nombre,
    m.id_movimiento AS id_movimiento_imputado
  FROM consumos_tc AS tc
  JOIN tarjetas AS t   ON tc.id_tarjeta  = t.id_tarjeta
  LEFT JOIN categorias AS cat ON tc.id_categoria = cat.id_categoria
  LEFT JOIN movimientos AS m  ON tc.id_consumo_tarjeta = m.id_consumo_tarjeta_origen
  WHERE t.id_cuenta_principal = p_id_cuenta
    AND tc.fecha BETWEEN p_fecha_inicio AND p_fecha_fin
  ORDER BY tc.fecha DESC, tc.created_at DESC;
$function$
;
ALTER FUNCTION public.get_consumos_tc_list(text,date,date) SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION public.provision_new_user_environment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Yo'),
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
$function$
;
ALTER FUNCTION public.provision_new_user_environment() SET search_path=public,pg_temp;
CREATE OR REPLACE FUNCTION fluxo_private.check_owner_references() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE payload jsonb := to_jsonb(NEW); ref_value text; target text; pk text; field text; found_owner uuid;
BEGIN
IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Cannot change owner' USING ERRCODE='42501'; END IF;
FOR field,target,pk IN SELECT * FROM (VALUES ('id_cuenta_principal','cuentas_principales','id_cuenta_principal'),('id_tarjeta','tarjetas','id_tarjeta'),('id_subcuenta','ahorro_subcuentas','id_subcuenta'),('id_categoria','categorias','id_categoria'),('id_usuario','cta_corriente_usuarios','id_usuario'),('id_movimiento_origen','movimientos','id_movimiento'),('id_consumo_tarjeta_origen','consumos_tc','id_consumo_tarjeta')) x LOOP
IF target=TG_TABLE_NAME THEN CONTINUE; END IF;
ref_value:=payload->>field;
IF ref_value IS NOT NULL AND ref_value<>'' THEN
EXECUTE format('SELECT user_id FROM public.%I WHERE %I::text=$1',target,pk) INTO found_owner USING ref_value;
IF found_owner IS DISTINCT FROM NEW.user_id AND NOT (target='categorias' AND EXISTS(SELECT 1 FROM public.categorias WHERE id_categoria=ref_value AND user_id IS NULL)) THEN RAISE EXCEPTION 'Invalid owner reference: %',field USING ERRCODE='42501'; END IF;
END IF; END LOOP; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.ahorro_subcuentas;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.ahorro_subcuentas FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS ahorro_subcuentas_owner_idx ON public.ahorro_subcuentas(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.ahorros;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.ahorros FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS ahorros_owner_idx ON public.ahorros(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.bot_sessions;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.bot_sessions FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS bot_sessions_owner_idx ON public.bot_sessions(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.categorias;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.categorias FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS categorias_owner_idx ON public.categorias(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.cc_consumos;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.cc_consumos FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS cc_consumos_owner_idx ON public.cc_consumos(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.consumos_tc;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.consumos_tc FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS consumos_tc_owner_idx ON public.consumos_tc(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.cta_corriente_usuarios;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.cta_corriente_usuarios FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS cta_corriente_usuarios_owner_idx ON public.cta_corriente_usuarios(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.cuentas_principales;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.cuentas_principales FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS cuentas_principales_owner_idx ON public.cuentas_principales(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.inversiones_movimientos;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.inversiones_movimientos FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS inversiones_movimientos_owner_idx ON public.inversiones_movimientos(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.movimientos;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.movimientos FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS movimientos_owner_idx ON public.movimientos(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.recordatorios;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.recordatorios FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS recordatorios_owner_idx ON public.recordatorios(user_id);
DROP TRIGGER IF EXISTS fluxo_owner_references ON public.tarjetas;
CREATE TRIGGER fluxo_owner_references BEFORE INSERT OR UPDATE ON public.tarjetas FOR EACH ROW EXECUTE FUNCTION fluxo_private.check_owner_references();
CREATE INDEX IF NOT EXISTS tarjetas_owner_idx ON public.tarjetas(user_id);
GRANT USAGE ON SCHEMA fluxo_private TO fluxo_runtime;
GRANT SELECT,INSERT,DELETE ON fluxo_private.requests TO fluxo_runtime;
CREATE TABLE IF NOT EXISTS fluxo_private.telegram_updates(update_id text PRIMARY KEY,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS fluxo_private.reminder_delivery(id_recordatorio uuid NOT NULL,due_date date NOT NULL,status text NOT NULL DEFAULT 'pending',updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(id_recordatorio,due_date));
GRANT SELECT,INSERT,UPDATE ON fluxo_private.telegram_updates,fluxo_private.reminder_delivery TO fluxo_runtime;
CREATE TABLE IF NOT EXISTS fluxo_private.cron_locks(name text PRIMARY KEY,lease uuid NOT NULL,expires_at timestamptz NOT NULL);
GRANT SELECT,INSERT,UPDATE,DELETE ON fluxo_private.cron_locks TO fluxo_runtime;
GRANT DELETE ON fluxo_private.reminder_delivery TO fluxo_runtime;
CREATE INDEX IF NOT EXISTS movimentos_owner_account_date_idx ON public.movimientos(user_id,id_cuenta_principal,fecha);
CREATE INDEX IF NOT EXISTS consumos_tc_owner_card_date_idx ON public.consumos_tc(user_id,id_tarjeta,fecha);
CREATE INDEX IF NOT EXISTS cc_consumos_owner_account_date_idx ON public.cc_consumos(user_id,id_cuenta_principal,fecha);
CREATE INDEX IF NOT EXISTS recordatorios_due_idx ON public.recordatorios(fecha_proxima) WHERE activa;
COMMIT;
