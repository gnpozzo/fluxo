-- Migración para soporte de alcancías/subcuentas en transferencias de ahorro
ALTER TABLE public.ahorros 
  ADD COLUMN IF NOT EXISTS id_subcuenta TEXT;

-- Opcional: Índice para acelerar agregaciones por subcuenta
CREATE INDEX IF NOT EXISTS idx_ahorros_id_subcuenta ON public.ahorros(id_subcuenta);
