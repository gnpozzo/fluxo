import { addMonthsSafe, allocateMoney } from '../shared/finance.js';
import createConsumoTC from './createConsumoTC.js';
import { inputError } from '../api_lib/validation.js';
import { getSupabaseClient } from '../api_lib/supabase.js';
import { resolveUserCuenta } from '../api_lib/auth.js';
import crypto from 'crypto';

// Mapping frontend UI frequencies to month step intervals
const FREQ_MAP = {
  MENSUAL: 1,
  BIMESTRAL: 2,
  TRIMESTRAL: 3,
  SEMESTRAL: 6,
  ANUAL: 12
};



export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    let mov = req.body;
    if (Array.isArray(mov)) {
      mov = mov[0];
    } else if (mov && Array.isArray(mov.args)) {
      mov = mov.args[0];
    } else if (typeof mov === 'string') {
      try {
        const parsed = JSON.parse(mov);
        mov = Array.isArray(parsed) ? parsed[0] : (parsed.args ? parsed.args[0] : parsed);
      } catch (e) {}
    }
    mov = mov || {};
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    // Validate and resolve account ownership
    const resolvedCuenta = await resolveUserCuenta(supabase, mov.idCuenta, userId);
    if (!resolvedCuenta) {
      return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta seleccionada no pertenece al usuario autenticado.' });
    }
    mov.idCuenta = resolvedCuenta;

    if (mov.tipoConsumo === 'CUOTAS' && mov.idTarjetaCuotas) {
      if (mov.esSplit || mov.tipo !== 'EGRESO') throw inputError('Las cuotas con tarjeta requieren un egreso sin distribución.');
      return createConsumoTC({ ...req, body: { ...mov, idTarjeta: mov.idTarjetaCuotas, imputar: true, idCuentaImputar: mov.idCuenta } }, res);
    }

    const rows = [];
    const fechaBase = new Date(mov.fecha + 'T12:00:00Z');

    let pctRetenido = 100;
    const destinos = [];
    if (mov.esSplit && Array.isArray(mov.splitDestinos)) {
      for (const d of mov.splitDestinos) {
        const pct = parseFloat(d.pct);
        if (isNaN(pct) || pct <= 0) throw new Error('Porcentaje de distribución inválido.');
        
        // Verify ownership of destination account
        const destOwner = await resolveUserCuenta(supabase, d.cuenta, userId);
        if (!destOwner) {
          return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta de destino no pertenece al usuario autenticado.' });
        }

        pctRetenido -= pct;
        destinos.push({ cuenta: destOwner, pct: pct / 100 });
      }
      if (pctRetenido < 0) throw new Error('La suma de porcentajes de distribución supera el 100%.');
    }

    let periodos = 1;
    let esCuotas = false;
    let groupIdPrefix = 'REC_';
    let monthStep = 1; // default monthly
    
    if (mov.tipoConsumo === 'CUOTAS') {
      periodos = (Number(mov.cuotaTotal) || 2) - (Number(mov.cuotaActual) || 1) + 1;
      esCuotas = true;
      groupIdPrefix = 'INSTL_';
    } else if (mov.tipoConsumo === 'RECURRENTE') {
      periodos = Number(mov.periodos) || 12;
      monthStep = FREQ_MAP[mov.frecuencia] || 1;
    }

    if (periodos < 1) periodos = 1;
    const isSeries = periodos > 1;
    const seriesGroupId = isSeries ? (req.seriesGroupId || groupIdPrefix + crypto.randomUUID()) : null;

    // Store frequency metadata in the first row for later editing
    const metaFrequency = mov.tipoConsumo === 'RECURRENTE' ? (mov.frecuencia || 'MENSUAL') : null;

    // Sanitize description to remove any residual cuota annotations
    const baseDesc = (mov.descripcion || '')
      .replace(/\s*\(Cuota\s+\d+\/\d+\)/gi, '')
      .replace(/\s*\(\d+\/\d+\)/g, '')
      .trim();

    for (let i = 0; i < periodos; i++) {
      const monthsToAdd = esCuotas ? i : (i * monthStep);
      const fechaISO = addMonthsSafe(fechaBase, monthsToAdd).toISOString().split('T')[0];
      
      let desc = baseDesc;
      if (esCuotas) {
         const cuotaNro = (Number(mov.cuotaActual) || 1) + i;
         desc = `${baseDesc} (Cuota ${cuotaNro}/${mov.cuotaTotal})`;
      }

      if (mov.esSplit && destinos.length > 0) {
        const splitGroupId = 'SPLIT_' + crypto.randomUUID();
        const shares = allocateMoney(mov.importe, [...destinos.map(d => d.pct * 100), ...(pctRetenido > 0 ? [pctRetenido] : [])]);
        // Destinos
        destinos.forEach((d, index) => {
          const importeDestino = shares[index];
          rows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: d.cuenta,
            user_id: userId,
            fecha: fechaISO,
            id_categoria: mov.idCategoria,
            tipo_mov: mov.tipo,
            descripcion: desc,
            importe: importeDestino,
            medio_pago: mov.medioPago,
            moneda: mov.moneda || 'ARS',
            recur_group_id: seriesGroupId,
            split_group_id: splitGroupId,
            split_rol: 'DESTINO'
          });
        });
        
        // Origen Remanente (solo si queda porcentaje en la cuenta origen)
        if (pctRetenido > 0) {
          const importeOrigen = shares.at(-1);
          rows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: mov.idCuenta,
            user_id: userId,
            fecha: fechaISO,
            id_categoria: mov.idCategoria,
            tipo_mov: mov.tipo,
            descripcion: desc,
            importe: importeOrigen,
            medio_pago: mov.medioPago,
            moneda: mov.moneda || 'ARS',
            recur_group_id: seriesGroupId,
            split_group_id: splitGroupId,
            split_rol: 'ORIGEN'
          });
        }
      } else {
        // CASO NORMAL
        const row = {
          id_movimiento: crypto.randomUUID(),
          id_cuenta_principal: mov.idCuenta,
          user_id: userId,
          fecha: fechaISO,
          id_categoria: mov.idCategoria,
          tipo_mov: mov.tipo,
          descripcion: desc,
          importe: mov.importe,
          medio_pago: mov.medioPago,
            moneda: mov.moneda || 'ARS',
          recur_group_id: seriesGroupId
        };

        rows.push(row);
      }
    }

    if (rows.length === 0) throw new Error('No se generaron registros para la creación.');

    const { error } = await supabase.from('movimientos').insert(rows);
    if (error) throw error;

    return res.status(200).json({ success: true, data: { count: rows.length } });
  } catch (err) {
    console.error('[API -> createMovimiento]', err.message);
    return res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'No se pudo completar la operación.' });
  }
}
