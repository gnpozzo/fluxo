-- Agrega la columna de cuenta asociada a la tabla de subcuentas de ahorro
ALTER TABLE public.ahorro_subcuentas 
ADD COLUMN IF NOT EXISTS id_cuenta_principal TEXT REFERENCES public.cuentas_principales(id_cuenta_principal) ON DELETE SET NULL;
