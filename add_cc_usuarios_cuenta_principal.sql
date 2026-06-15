-- Agrega la columna de cuenta asociada a la tabla de usuarios de cuenta corriente (contactos)
ALTER TABLE public.cta_corriente_usuarios 
ADD COLUMN IF NOT EXISTS id_cuenta_principal TEXT REFERENCES public.cuentas_principales(id_cuenta_principal) ON DELETE CASCADE;
