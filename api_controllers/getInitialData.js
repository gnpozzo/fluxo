import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);

    const [cuentasRes, categoriasRes, tarjetasRes, usuariosCcRes, subcuentasRes] = await Promise.all([
      supabase.from('cuentas_principales').select('id_cuenta_principal,nombre,moneda_principal,es_predeterminada,activa,fecha_creacion,modulo_tarjetas_activo,modulo_cc_activo,modulo_ahorro_activo,modulo_inversiones_activo').eq('activa', true).order('es_predeterminada', { ascending: false }).order('nombre', { ascending: true }),
      supabase.from('categorias').select('*').eq('activa', true).order('tipo_mov', { ascending: true }).order('nombre', { ascending: true }),
      supabase.from('tarjetas').select('*').eq('activa', true).order('id_cuenta_principal', { ascending: true }).order('nombre', { ascending: true }),
      supabase.from('cta_corriente_usuarios').select('*').order('nombre', { ascending: true }),
      supabase.from('ahorro_subcuentas').select('*')
    ]);

    if (cuentasRes.error) throw cuentasRes.error;
    if (categoriasRes.error) throw categoriasRes.error;
    if (tarjetasRes.error) throw tarjetasRes.error;
    if (usuariosCcRes.error) throw usuariosCcRes.error;
    if (subcuentasRes.error) throw subcuentasRes.error;

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
      cuentas: cuentasRes.data,
      meses: meses,
      categorias: categoriasRes.data,
      tarjetas: tarjetasRes.data,
      subcuentas: subcuentasRes.data,
      usuarios_cc: usuariosCcRes.data
    });
  } catch (err) {
    console.error('[API -> getInitialData Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}