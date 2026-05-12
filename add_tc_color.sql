-- Agrega la columna de color a la tabla de tarjetas de crédito
ALTER TABLE public.tarjetas ADD COLUMN IF NOT EXISTS color varchar(50) DEFAULT 'blue';
