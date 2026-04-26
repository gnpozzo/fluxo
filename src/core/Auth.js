// [Origen -> src/core -> Auth.js]
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mock.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'mock_key';

export const supabase = createClient(supabaseUrl, supabaseKey);

class AuthService {
  constructor() {
    this.session = null;
    this.user = null;
  }

  async init() {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Auth error on init:', error.message);
    }
    if (data && data.session) {
      this.session = data.session;
      this.user = data.session.user;
      return true;
    }
    return false;
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
