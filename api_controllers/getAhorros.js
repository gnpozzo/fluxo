import { readAll } from '../api_lib/read-all.js';
import { getSupabaseClient } from '../api_lib/supabase.js';
import { resolveUserCuenta } from '../api_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);
    let finalArgs = [];
    if (Array.isArray(req.body)) {
      finalArgs = req.body;
    } else if (req.body && Array.isArray(req.body.args)) {
      finalArgs = req.body.args;
    } else if (typeof req.body === 'string') {
      try { finalArgs = JSON.parse(req.body); if (finalArgs.args) finalArgs = finalArgs.args; } catch(e){}
    }
    let [cuenta, fechaInicio, fechaFin] = finalArgs;

    if (!cuenta) throw new Error("Falta id de cuenta");

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const resolvedCuenta = await resolveUserCuenta(supabase, cuenta, userId);
    if (!resolvedCuenta) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
    }
    cuenta = resolvedCuenta;

    const {data:subcuentas,error:subError}=await supabase.from('ahorro_subcuentas').select('*').eq('id_cuenta_principal',cuenta).eq('user_id',userId);
    if(subError) throw subError;
    const rows=await readAll(()=>supabase.from('ahorros').select('*, movimientos!inner(id_cuenta_principal)').eq('user_id',userId).eq('movimientos.id_cuenta_principal',cuenta).lte('fecha',fechaFin).order('fecha').order('id_ahorro'));
    let arsTotal=0,usdTotal=0;
    for(const row of rows){const value=Number(row.importe)*(row.tipo_transfer==='DEPOSITO'?1:-1);if(row.moneda==='USD')usdTotal+=value;else arsTotal+=value;}
    const subcuentaNames=new Map((subcuentas || []).map(subcuenta=>[subcuenta.id_subcuenta,subcuenta.nombre]));
    const transferenciasHistoricas=rows.map(a=>({...a,subcuenta_nombre:subcuentaNames.get(a.id_subcuenta)||'General',tipo_mov:a.tipo_transfer}));
    const transferencias=transferenciasHistoricas.filter(a=>a.fecha>=fechaInicio);
    return res.status(200).json({success:true,kpis:{arsTotal,usdTotal,consolidadoArs:usdTotal===0?arsTotal:null},subcuentas:subcuentas||[],transferencias,transferenciasHistoricas});

  } catch (err) {
    console.error('[API -> getAhorros Error]', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'No se pudo completar la operación.' });
  }
}

