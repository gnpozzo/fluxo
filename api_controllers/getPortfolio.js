import { holdings } from '../shared/finance.js';
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
    } else if (req.body && typeof req.body === 'object') {
      finalArgs = [req.body.cuenta || req.body.idCuenta];
    }

    let idCuenta = finalArgs[0];
    if (!idCuenta) {
      return res.status(400).json({ success: false, error: 'Falta parámetro idCuenta' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'No autenticado' });
    }

    const resolvedCuenta = await resolveUserCuenta(supabase, idCuenta, userId);
    if (!resolvedCuenta) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
    }
    idCuenta = resolvedCuenta;

    let movimientos = [];

    movimientos = await readAll(() => supabase.from('inversiones_movimientos').select('*').eq('id_cuenta_principal',idCuenta).eq('user_id',userId).order('fecha').order('created_at').order('id_inversion_mov'));

    if (!movimientos || movimientos.length === 0) {
      return res.status(200).json({
        success: true,
        kpis: { valorActual: 0, costoTotal: 0, gananciaTotal: 0, rendimientoPorc: 0 },
        portfolio: []
      });
    }

    // 2. Extraer tickers únicos para cotización
    const tickersUnicos = [...new Set(movimientos.map(m => m.ticker).filter(Boolean))];
    const preciosPorTicker = {};

    let cotizUSD = null;
    try {
      const response=await fetch('https://dolarapi.com/v1/dolares/bolsa',{signal:AbortSignal.timeout(3000)});
      if(response.ok){const quote=await response.json();if(Number(quote.venta)>0 && Date.now()-Date.parse(quote.fechaActualizacion)<3*86400000) cotizUSD=Number(quote.venta);}
    }catch{}
    await Promise.all(tickersUnicos.map(async ticker=>{
      try {
        const response=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(ticker),{signal:AbortSignal.timeout(3000)});
        if(!response.ok)return;
        const meta=(await response.json())?.chart?.result?.[0]?.meta;
        if(Number(meta?.regularMarketPrice)>0 && meta.currency && Date.now()-Number(meta.regularMarketTime)*1000<7*86400000) preciosPorTicker[ticker]={price:Number(meta.regularMarketPrice),currency:meta.currency,fechaActualizacion:new Date(meta.regularMarketTime*1000).toISOString()};
      }catch{}
    }));

    const tenencias = holdings(movimientos).filter(h=>h.quantity>0.000001).map(h=>{
      const quote=preciosPorTicker[h.ticker];
      const priced=quote?.currency===h.moneda && (h.moneda!=='USD' || cotizUSD>0);
      const current=priced ? h.quantity*quote.price*(h.moneda==='USD'?cotizUSD:1) : null;
      return {...h,cantidad:h.quantity,costoTotalArs:h.costArs,precioProm:h.costNative/h.quantity,precioActual:priced?quote.price:null,valorActualArs:current,gananciaArs:current===null?null:current-h.costArs,rendPct:current===null?null:(h.costArs>0?(current-h.costArs)/h.costArs*100:0)};
    });
    const complete=tenencias.every(h=>h.valorActualArs!==null);
    const cost=tenencias.reduce((sum,h)=>sum+h.costArs,0);
    const value=complete?tenencias.reduce((sum,h)=>sum+h.valorActualArs,0):null;
    const portfolio=movimientos.map(m=>({id_operacion:m.id_inversion_mov,fecha:m.fecha,created_at:m.created_at,tipo_op:m.tipo_operacion,ticker:m.ticker,moneda:m.moneda,cantidad:Number(m.cantidad_nominales),precio:Number(m.precio_compra),importe_total_ars:Number(m.importe_total_ars),precio_actual:preciosPorTicker[m.ticker]?.currency===m.moneda?preciosPorTicker[m.ticker].price:null,ganancia:null}));
    return res.status(200).json({success:true,kpis:{valorActual:value,costoTotal:cost,gananciaTotal:value===null?null:value-cost,rendimientoPorc:value===null?null:(cost>0?(value-cost)/cost*100:0),valuacionCompleta:complete},tenencias,portfolio});

  } catch (err) {
    console.error('[getPortfolio -> ERROR]', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'No se pudo completar la operación.' });
  }
}
