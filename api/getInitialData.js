import { getSupabaseClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);

    const [cuentasRes, categoriasRes, tarjetasRes, usuariosCcRes] = await Promise.all([
      supabase.from('cuentas_principales').select('id_cuenta_principal,nombre,moneda_principal,es_predeterminada,activa,fecha_creacion,modulo_tarjetas_activo,modulo_cc_activo,modulo_ahorro_activo,modulo_inversiones_activo').eq('activa', true).order('es_predeterminada', { ascending: false }).order('nombre', { ascending: true }),
      supabase.from('categorias').select('*').eq('activa', true).order('tipo_mov', { ascending: true }).order('nombre', { ascending: true }),
      supabase.from('tarjetas').select('*').eq('activa', true).order('id_cuenta_principal', { ascending: true }).order('nombre', { ascending: true }),
      supabase.from('cta_corriente_usuarios').select('*').order('nombre', { ascending: true })
    ]);

    if (cuentasRes.error) throw cuentasRes.error;
    if (categoriasRes.error) throw categoriasRes.error;
    if (tarjetasRes.error) throw tarjetasRes.error;
    if (usuariosCcRes.error) throw usuariosCcRes.error;

    // TODO: fetch actual months from "movimientos" using RPC or group by
    const meses = ['2023-10', '2023-11', '2023-12', '2024-01', '2024-02', '2024-03', '2024-04'];

    return res.status(200).json({
      success: true,
      cuentas: cuentasRes.data,
      meses: meses,
      categorias: categoriasRes.data,
      tarjetas: tarjetasRes.data,
      usuarios_cc: usuariosCcRes.data
    });
  } catch (err) {
    console.error('[API -> getInitialData Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}