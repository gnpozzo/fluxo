-- Superseded by versioned migrations. The historical definition has columns absent from the live schema.
DO $$ BEGIN RAISE EXCEPTION 'Script obsoleto: usar supabase/migrations.'; END $$;
