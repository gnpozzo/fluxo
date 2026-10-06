-- Additive migration: existing descriptions and amounts remain untouched.
BEGIN;
ALTER TABLE public.movimientos ADD COLUMN IF NOT EXISTS cuota_actual integer;
ALTER TABLE public.movimientos ADD COLUMN IF NOT EXISTS cuota_total integer;

-- Prefer explicit metadata from the linked purchase.
UPDATE public.movimientos m SET cuota_actual=c.cuota_actual, cuota_total=c.cuota_total
FROM public.consumos_tc c
WHERE m.id_consumo_tarjeta_origen=c.id_consumo_tarjeta AND m.user_id=c.user_id
  AND m.cuota_total IS NULL AND c.cuota_total>1;

-- Legacy non-card installments stored their position in a trailing suffix.
WITH legacy AS (
  SELECT id_movimiento, regexp_match(descripcion, '\((?:Cuota\s+)?([0-9]{1,4})/([0-9]{1,4})\)\s*$', 'i') AS parts
  FROM public.movimientos WHERE cuota_total IS NULL AND recur_group_id LIKE 'INSTL_%'
)
UPDATE public.movimientos m
SET cuota_actual=parts[1]::integer, cuota_total=parts[2]::integer
FROM legacy WHERE m.id_movimiento=legacy.id_movimiento
  AND parts IS NOT NULL AND parts[1]::integer>0 AND parts[2]::integer>=parts[1]::integer;
NOTIFY pgrst, 'reload schema';
COMMIT;
