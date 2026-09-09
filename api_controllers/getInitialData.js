import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized: User context missing' });
    }

    let [cuentasRes, categoriasRes, tarjetasRes, usuariosCcRes, subcuentasRes] = await Promise.all([
      supabase.from('cuentas_principales')
        .select('id_cuenta_principal,nombre,moneda_principal,es_predeterminada,activa,fecha_creacion,modulo_tarjetas_activo,modulo_cc_activo,modulo_ahorro_activo,modulo_inversiones_activo')
        .eq('user_id', userId)
        .eq('activa', true)
        .order('es_predeterminada', { ascending: false })
        .order('nombre', { ascending: true }),
      supabase.from('categorias')
        .select('*')
        .or(`user_id.is.null,user_id.eq.${userId}`)
        .eq('activa', true)
        .order('tipo_mov', { ascending: true })
        .order('nombre', { ascending: true }),
      supabase.from('tarjetas')
        .select('*')
        .eq('user_id', userId)
        .eq('activa', true)
        .order('id_cuenta_principal', { ascending: true })
        .order('nombre', { ascending: true }),
      supabase.from('cta_corriente_usuarios')
        .select('*')
        .eq('user_id', userId)
        .order('nombre', { ascending: true }),
      supabase.from('ahorro_subcuentas')
        .select('*')
        .eq('user_id', userId)
    ]);

    if (cuentasRes.error) throw cuentasRes.error;
    if (categoriasRes.error) throw categoriasRes.error;
    if (tarjetasRes.error) throw tarjetasRes.error;
    if (usuariosCcRes.error) throw usuariosCcRes.error;
    if (subcuentasRes.error) throw subcuentasRes.error;

    let cuentas = cuentasRes.data || [];
    let subcuentas = subcuentasRes.data || [];
    let usuariosCc = usuariosCcRes.data || [];

    // Auto-provision default environment for this user if no account exists yet
    if (cuentas.length === 0) {
      const insertCuenta = await supabase.from('cuentas_principales').insert([{
        nombre: 'Personal',
        moneda_principal: 'ARS',
        es_predeterminada: true,
        activa: true,
        user_id: userId,
        modulo_tarjetas_activo: true,
        modulo_cc_activo: true,
        modulo_ahorro_activo: true,
        modulo_inversiones_activo: true
      }]).select();

      if (!insertCuenta.error && insertCuenta.data?.length > 0) {
        cuentas = insertCuenta.data;
        const newAccountId = cuentas[0].id_cuenta_principal;

        const userName = req.user.user_metadata?.full_name || req.user.email?.split('@')[0] || 'Yo (Principal)';
        const insertCc = await supabase.from('cta_corriente_usuarios').insert([{
          nombre: userName,
          es_yo: true,
          id_cuenta_principal: newAccountId,
          user_id: userId
        }]).select();
        if (insertCc.data) usuariosCc = insertCc.data;

        const insertSub = await supabase.from('ahorro_subcuentas').insert([
          { id_cuenta_principal: newAccountId, nombre: 'Fondo de Emergencia', user_id: userId },
          { id_cuenta_principal: newAccountId, nombre: 'Ahorro General', user_id: userId }
        ]).select();
        if (insertSub.data) subcuentas = insertSub.data;
      }
    }

    // Generate dynamic list of months (-12 to +6 months from now)
    const meses = [];
    const today = new Date();
    for (let i = -12; i <= 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      meses.push(`${yyyy}-${mm}`);
    }

    return res.status(200).json({
      success: true,
      cuentas: cuentas,
      meses: meses,
      categorias: categoriasRes.data || [],
      tarjetas: tarjetasRes.data || [],
      subcuentas: subcuentas,
      usuarios_cc: usuariosCc
    });
  } catch (err) {
    console.error('[API -> getInitialData Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}