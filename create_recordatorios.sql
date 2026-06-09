-- ==============================================================================
-- FLUXO FINANCIAL APP - REMINDERS (RECORDATORIOS) TABLE
-- ==============================================================================
-- Table to configure alerts and reminders via App, Telegram and Mail.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.recordatorios (
    id_recordatorio UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_cuenta_principal TEXT REFERENCES public.cuentas_principales(id_cuenta_principal) ON DELETE CASCADE,
    chat_id TEXT NOT NULL,
    mensaje TEXT NOT NULL,
    frecuencia TEXT NOT NULL DEFAULT 'MENSUAL', -- 'UNICA', 'MENSUAL', 'DIAS_HABILES'
    dia_mes INTEGER, -- ej: 5 para día 5 del mes
    dia_habil INTEGER, -- ej: 5 para 5to día hábil
    fecha_proxima DATE,
    canales TEXT NOT NULL DEFAULT 'TELEGRAM', -- 'TELEGRAM', 'APP', 'MAIL', etc.
    activa BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.recordatorios ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists
DROP POLICY IF EXISTS "Enable ALL for service role" ON public.recordatorios;
DROP POLICY IF EXISTS "Enable ALL for authenticated users" ON public.recordatorios;

-- Create policies for access
CREATE POLICY "Enable ALL for service role" ON public.recordatorios
    FOR ALL USING (true) WITH CHECK (true);

-- Index for cron lookups
CREATE INDEX IF NOT EXISTS idx_recordatorios_fecha_proxima ON public.recordatorios(fecha_proxima) WHERE activa = true;

-- END OF SCRIPT
