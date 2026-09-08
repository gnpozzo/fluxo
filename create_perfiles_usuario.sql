-- ==============================================================================
-- FLUXO - PERFILES DE USUARIO & SINCRONIZACIÓN CON SUPABASE AUTH
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.perfiles_usuario (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  nombre TEXT,
  avatar_url TEXT,
  preferencias JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habilitar RLS
ALTER TABLE public.perfiles_usuario ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Los usuarios pueden gestionar su propio perfil" ON public.perfiles_usuario;
CREATE POLICY "Los usuarios pueden gestionar su propio perfil"
  ON public.perfiles_usuario
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Lectura de perfiles para usuarios autenticados" ON public.perfiles_usuario;
CREATE POLICY "Lectura de perfiles para usuarios autenticados"
  ON public.perfiles_usuario
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Función Trigger para poblar perfiles_usuario al registrarse o actualizar auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.perfiles_usuario (id, email, nombre, avatar_url)
  VALUES (
    new.id,
    new.email,
    COALESCE(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      initcap(replace(split_part(new.email, '@', 1), '.', ' '))
    ),
    COALESCE(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture',
      ''
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    nombre = COALESCE(EXCLUDED.nombre, public.perfiles_usuario.nombre),
    avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), public.perfiles_usuario.avatar_url),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Disparador tras inserción/actualización en auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Poblar perfiles existentes si ya hay usuarios en auth.users
INSERT INTO public.perfiles_usuario (id, email, nombre, avatar_url)
SELECT 
  id,
  email,
  COALESCE(
    raw_user_meta_data->>'full_name',
    raw_user_meta_data->>'name',
    initcap(replace(split_part(email, '@', 1), '.', ' '))
  ),
  COALESCE(
    raw_user_meta_data->>'avatar_url',
    raw_user_meta_data->>'picture',
    ''
  )
FROM auth.users
ON CONFLICT (id) DO NOTHING;
