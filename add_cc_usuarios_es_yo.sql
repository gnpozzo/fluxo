-- Agrega la columna es_yo a la tabla de usuarios de cuenta corriente
ALTER TABLE public.cta_corriente_usuarios ADD COLUMN IF NOT EXISTS es_yo BOOLEAN DEFAULT false;
