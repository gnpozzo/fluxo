-- ==============================================================================
-- FLUXO FINANCIAL APP - BOT SESSIONS TABLE
-- ==============================================================================
-- Table to store conversation history and guided session state for the Telegram bot.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.bot_sessions (
    chat_id TEXT PRIMARY KEY,
    history JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.bot_sessions ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists
DROP POLICY IF EXISTS "Enable ALL for service role" ON public.bot_sessions;

-- Create policy to allow full access for bot webhook queries (bypassing RLS)
CREATE POLICY "Enable ALL for service role" ON public.bot_sessions
    FOR ALL USING (true) WITH CHECK (true);

-- END OF SCRIPT
