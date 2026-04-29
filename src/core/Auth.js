// [Origen -> src/core -> Auth.js]
import { createClient } from '@supabase/supabase-js';

// Cliente de Supabase inicialmente null, se construye dinámicamente
export let supabase = null;

class AuthService {
  constructor() {
    this.session = null;
    this.user = null;
  }

  async init() {
    // CAPTURAR EL HASH ANTES DE NADA.
    // Supabase createClient lo borra de la URL casi instantáneamente.
    const capturedHash = window.location.hash || (window.location.href.includes('#') ? '#' + window.location.href.split('#')[1] : '');
    
    // 1. Obtener la configuración dinámica de lado del servidor
    // Esto previene fallos si VITE_SUPABASE_URL no está seteado pre-build en Vercel
    try {
      const res = await fetch('/api/getConfig');
      const config = await res.json();
      const url = config.url || import.meta.env.VITE_SUPABASE_URL || 'https://mock.supabase.co';
      const anonKey = config.anonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || 'mock_key';
      
      supabase = createClient(url, anonKey);
    } catch (err) {
      console.error('Error fetching Supabase Config:', err);
      // Fallback a build-time estático
      const url = import.meta.env.VITE_SUPABASE_URL || 'https://mock.supabase.co';
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'mock_key';
      supabase = createClient(url, anonKey);
    }

    // 2. Extraer sesión usando SDK inicializado
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Auth error on init:', error.message);
    }
    if (data && data.session) {
      this.session = data.session;
      this.user = data.session.user;
      if (capturedHash.includes('access_token=')) {
         window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return true;
    }
    
    // Supabase procesa el hash de la URL de manera asíncrona, pero a veces falla por condiciones de carrera.
    if (capturedHash.includes('access_token=')) {
      const hashParams = new URLSearchParams(capturedHash.substring(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      
      if (accessToken && refreshToken) {
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        
        if (!sessionError && sessionData?.session) {
          this.session = sessionData.session;
          this.user = sessionData.session.user;
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
          return true;
        } else {
          console.error('Error crítico setting session manually:', sessionError);
          // Borrar el hash roto para no quedar atrapados en un loop
          window.history.replaceState(null, '', window.location.pathname);
          return false;
        }
      }
    }

    // Listener permanente en background
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        this.session = session;
        this.user = session?.user;
      }
    });

    return !!this.session;
  }

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    this.session = data.session;
    this.user = data.session.user;
    return data;
  }

  async loginWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) throw error;
    // OAuth redirige la página, así que la sesión se cargará en el próximo init()
    return data;
  }

  async signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    });
    if (error) throw error;
    this.session = data.session;
    this.user = data.session.user;
    return data;
  }

  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    this.session = null;
    this.user = null;
  }

  getToken() {
    return this.session?.access_token || null;
  }
}

export const Auth = new AuthService();
