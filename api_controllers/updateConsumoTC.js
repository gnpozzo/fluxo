import { getSupabaseClient } from '../api_lib/supabase.js';
import crypto from 'crypto';

function parseDateSafe(val) {
  if (!val) return new Date();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  const s = String(val).trim();
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3];
    return new Date(`${year}-${month}-${day}T12:00:00Z`);
  }
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const year = ymd[1];
    const month = ymd[2].padStart(2, '0');
    const day = ymd[3].padStart(2, '0');
    return new Date(`${year}-${month}-${day}T12:00:00Z`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

function toIsoDateStr(val) {
  return parseDateSafe(val).toISOString().split('T')[0];
}

function addMonthsSafe(date, months) {
  const d = parseDateSafe(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) {
    d.setUTCDate(0);
  }
  return d;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supabase = getSupabaseClient(req);
    
    // Normalizar body ya sea que venga como { args: [...] }, [...] o {...}
    const bodyArgs = Array.isArray(req.body?.args) ? req.body.args : (Array.isArray(req.body) ? req.body : null);
    let request = null;
    let rawId = null;
    let rawScope = null;

    if (bodyArgs) {
      if (bodyArgs[1] && typeof bodyArgs[1] === 'object') {
        request = bodyArgs[1];
        rawId = typeof bodyArgs[0] === 'string' ? bodyArgs[0] : null;
        rawScope = typeof bodyArgs[2] === 'string' ? bodyArgs[2] : null;
      } else if (bodyArgs[0] && typeof bodyArgs[0] === 'object') {
        request = bodyArgs[0];
        rawScope = typeof bodyArgs[1] === 'string' ? bodyArgs[1] : null;
      } else {
        request = {};
        rawId = typeof bodyArgs[0] === 'string' ? bodyArgs[0] : null;
      }
    } else if (req.body && typeof req.body === 'object') {
      request = req.body;
    } else {
      request = {};
    }
    
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    const { original = {}, data = {} } = request || {};
    const scope = request.scope || rawScope || 'SINGLE';
    const origId = original.consumoId || original.id_consumo_tc || original.id_consumo_tarjeta || rawId;
    let recurGrp = original.recurGroupId || original.recur_group_id;

    // Resolver datos del consumo (data puede ser un subobjeto o el request mismo)
    const consumo = (data && Object.keys(data).length > 0) ? data : request;
    
    let targetTarjetaId = consumo.idTarjeta || consumo.id_tarjeta || original.id_tarjeta || original.idTarjeta;
    let targetCategoriaId = consumo.idCategoria || consumo.id_categoria || original.id_categoria || original.idCategoria;

    // Si faltan datos críticos o recurGrp, consultar el registro existente antes de borrar
    if ((!targetTarjetaId || !recurGrp || !targetCategoriaId) && origId) {
      const { data: existingTC } = await supabase
        .from('consumos_tc')
        .select('id_tarjeta, id_categoria, recur_group_id, fecha, descripcion, importe')
        .eq('id_consumo_tarjeta', origId)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingTC) {
        if (!targetTarjetaId) targetTarjetaId = existingTC.id_tarjeta;
        if (!targetCategoriaId) targetCategoriaId = existingTC.id_categoria;
        if (!recurGrp && existingTC.recur_group_id) recurGrp = existingTC.recur_group_id;
        if (!consumo.fecha && existingTC.fecha) consumo.fecha = existingTC.fecha;
        if (!consumo.descripcion && existingTC.descripcion) consumo.descripcion = existingTC.descripcion;
        if (consumo.importe === undefined && existingTC.importe !== undefined) consumo.importe = existingTC.importe;
      }
    }

    if (!targetTarjetaId) {
      return res.status(400).json({ success: false, error: 'Tarjeta de crédito no especificada o no encontrada.' });
    }
    
    // 1. Delete original (scoped to user_id)
    if (scope === 'SINGLE' && origId) {
      await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', origId).eq('user_id', userId);
      const { error: delTcErr } = await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', origId).eq('user_id', userId);
      if (delTcErr) throw delTcErr;
    } else if (scope === 'SERIES' && recurGrp) {
      const origFecha = toIsoDateStr(original.fecha?.value || original.fecha || consumo.fecha || '2000-01-01');
      const { data: tcs, error: qErr } = await supabase.from('consumos_tc').select('id_consumo_tarjeta')
        .eq('recur_group_id', recurGrp)
        .eq('user_id', userId)
        .gte('fecha', origFecha);
        
      if (qErr) throw qErr;

      if (tcs && tcs.length > 0) {
        const ids = tcs.map(r => r.id_consumo_tarjeta);
        await supabase.from('movimientos').delete().in('id_consumo_tarjeta_origen', ids).eq('user_id', userId);
        const { error: delSeriesErr } = await supabase.from('consumos_tc').delete().in('id_consumo_tarjeta', ids).eq('user_id', userId);
        if (delSeriesErr) throw delSeriesErr;
      }
    } else if (origId) {
      await supabase.from('movimientos').delete().eq('id_consumo_tarjeta_origen', origId).eq('user_id', userId);
      const { error: delSingleErr } = await supabase.from('consumos_tc').delete().eq('id_consumo_tarjeta', origId).eq('user_id', userId);
      if (delSingleErr) throw delSingleErr;
    }
    
    // 2. Resolve card account and due date
    let cardAccountId = null;
    let cardVto = null;
    if (targetTarjetaId) {
      const { data: tc } = await supabase
        .from('tarjetas')
        .select('id_tarjeta, id_cuenta_principal, fecha_vencimiento_actual')
        .eq('id_tarjeta', targetTarjetaId)
        .eq('user_id', userId)
        .maybeSingle();
      if (tc) {
        cardAccountId = tc.id_cuenta_principal;
        cardVto = tc.fecha_vencimiento_actual;
      }
    }

    const { data: allUserCuentas } = await supabase
      .from('cuentas_principales')
      .select('id_cuenta_principal, nombre')
      .eq('user_id', userId);
    const cuentaNombreMap = {};
    (allUserCuentas || []).forEach(c => { cuentaNombreMap[c.id_cuenta_principal] = c.nombre; });

    // 3. Create new records
    let tipo = consumo.tipoConsumo || consumo.tipo;
    if (scope === 'SINGLE') {
      tipo = 'SIMPLE';
    } else if (!tipo || tipo === 'COMUN' || tipo === 'SIMPLE') {
      if (recurGrp?.startsWith('REC_')) {
        tipo = 'RECURRENTE';
      } else if (recurGrp?.startsWith('INSTL_') || Number(consumo.cuotaTotal) > 1) {
        tipo = 'CUOTAS';
      }
    }

    const tcRows = [];
    const movRows = [];
    const cleanImporte = Number(String(consumo.importe || 0).replace(',', '.'));
    const fechaBase = parseDateSafe(consumo.fecha);
    const fechaISO = toIsoDateStr(fechaBase);
    const targetAccountId = consumo.idCuentaImputar || consumo.id_cuenta_imputar;

    if (tipo === 'SIMPLE' || tipo === 'COMUN') {
      const idConsumo = crypto.randomUUID();
      tcRows.push({
        id_consumo_tarjeta: idConsumo,
        id_tarjeta: targetTarjetaId,
        id_categoria: targetCategoriaId,
        user_id: userId,
        fecha: fechaISO,
        descripcion: consumo.descripcion,
        importe: cleanImporte
      });
      if (consumo.imputar && targetAccountId) {
        movRows.push({
          id_movimiento: crypto.randomUUID(),
          id_cuenta_principal: targetAccountId,
          user_id: userId,
          fecha: fechaISO,
          id_categoria: consumo.idCategoria,
          tipo_mov: 'EGRESO',
          descripcion: consumo.descripcion,
          importe: cleanImporte,
          medio_pago: 'Tarjeta de Crédito',
          id_consumo_tarjeta_origen: idConsumo
        });

        if (cardAccountId && targetAccountId !== cardAccountId) {
          const fechaReintegro = toIsoDateStr(cardVto || fechaISO);
          const targetAccName = cuentaNombreMap[targetAccountId] || 'Externa';
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: cardAccountId,
            user_id: userId,
            fecha: fechaReintegro,
            id_categoria: 'CAT_REINTEGRO_TC',
            tipo_mov: 'INGRESO',
            descripcion: `Reintegro TC: ${consumo.descripcion} (${targetAccName})`,
            importe: cleanImporte,
            medio_pago: 'Tarjeta de Crédito',
            id_consumo_tarjeta_origen: idConsumo
          });
        }
      }
    } else if (tipo === 'CUOTAS') {
      const installmentGroupId = (scope === 'SERIES' && recurGrp) ? recurGrp : ('INSTL_' + crypto.randomUUID());
      const cuotasARegistrar = (consumo.cuotaTotal - consumo.cuotaActual) + 1;
      for (let i = 0; i < cuotasARegistrar; i++) {
        const idConsumo = crypto.randomUUID();
        const cuotaNumActual = consumo.cuotaActual + i;
        const fechaCuota = toIsoDateStr(addMonthsSafe(fechaBase, i));
        tcRows.push({
          id_consumo_tarjeta: idConsumo,
          id_tarjeta: targetTarjetaId,
          id_categoria: targetCategoriaId,
          user_id: userId,
          fecha: fechaCuota,
          descripcion: consumo.descripcion,
          importe: cleanImporte,
          cuota_actual: cuotaNumActual,
          cuota_total: consumo.cuotaTotal,
          recur_group_id: installmentGroupId
        });
        if (consumo.imputar && targetAccountId) {
          const descImputacion = consumo.descripcion + ' (Cuota ' + cuotaNumActual + '/' + consumo.cuotaTotal + ')';
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: targetAccountId,
            user_id: userId,
            fecha: fechaCuota,
            id_categoria: targetCategoriaId,
            tipo_mov: 'EGRESO',
            descripcion: descImputacion,
            importe: cleanImporte,
            medio_pago: 'Tarjeta de Crédito',
            recur_group_id: installmentGroupId,
            id_consumo_tarjeta_origen: idConsumo
          });

          if (cardAccountId && targetAccountId !== cardAccountId) {
            const targetAccName = cuentaNombreMap[targetAccountId] || 'Externa';
            movRows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: cardAccountId,
              user_id: userId,
              fecha: fechaCuota,
              id_categoria: 'CAT_REINTEGRO_TC',
              tipo_mov: 'INGRESO',
              descripcion: `Reintegro TC: ${consumo.descripcion} (${cuotaNumActual}/${consumo.cuotaTotal}) (${targetAccName})`,
              importe: cleanImporte,
              medio_pago: 'Tarjeta de Crédito',
              recur_group_id: installmentGroupId,
              id_consumo_tarjeta_origen: idConsumo
            });
          }
        }
      }
    } else if (tipo === 'RECURRENTE') {
      const recurGroupId = (scope === 'SERIES' && recurGrp) ? recurGrp : ('REC_TC_' + crypto.randomUUID());
      const numPeriodos = consumo.periodos || 12;
      for (let i = 0; i < numPeriodos; i++) {
        const idConsumo = crypto.randomUUID();
        const fechaRec = toIsoDateStr(addMonthsSafe(fechaBase, i));
        tcRows.push({
          id_consumo_tarjeta: idConsumo,
          id_tarjeta: targetTarjetaId,
          id_categoria: targetCategoriaId,
          user_id: userId,
          fecha: fechaRec,
          descripcion: consumo.descripcion,
          importe: cleanImporte,
          recur_group_id: recurGroupId
        });
        if (consumo.imputar && targetAccountId) {
          movRows.push({
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: targetAccountId,
            user_id: userId,
            fecha: fechaRec,
            id_categoria: targetCategoriaId,
            tipo_mov: 'EGRESO',
            descripcion: consumo.descripcion,
            importe: cleanImporte,
            medio_pago: 'Tarjeta de Crédito',
            recur_group_id: recurGroupId,
            id_consumo_tarjeta_origen: idConsumo
          });

          if (cardAccountId && targetAccountId !== cardAccountId) {
            const targetAccName = cuentaNombreMap[targetAccountId] || 'Externa';
            movRows.push({
              id_movimiento: crypto.randomUUID(),
              id_cuenta_principal: cardAccountId,
              user_id: userId,
              fecha: fechaRec,
              id_categoria: 'CAT_REINTEGRO_TC',
              tipo_mov: 'INGRESO',
              descripcion: `Reintegro TC: ${consumo.descripcion} (${targetAccName})`,
              importe: cleanImporte,
              medio_pago: 'Tarjeta de Crédito',
              recur_group_id: recurGroupId,
              id_consumo_tarjeta_origen: idConsumo
            });
          }
        }
      }
    }

    if (tcRows.length > 0) {
      const { error: tcErr } = await supabase.from('consumos_tc').insert(tcRows);
      if (tcErr) {
        console.error('[updateConsumoTC] Error inserting tcRows:', tcErr);
        throw tcErr;
      }
    }
    if (movRows.length > 0) {
      const { error: movErr } = await supabase.from('movimientos').insert(movRows);
      if (movErr) {
        console.error('[updateConsumoTC] Error inserting movRows:', movErr);
        throw movErr;
      }
    }

    // 4. Guardar regla aprendida de imputación y categoría en perfiles_usuario
    if (targetAccountId && targetCategoriaId && consumo.descripcion) {
      try {
        const descRaw = String(consumo.descripcion).trim();
        const policyMatch = descRaw.match(/\b\d{6,}\b/);
        const policyId = policyMatch ? policyMatch[0] : null;

        const cleanWords = descRaw.toLowerCase()
          .replace(/[\/\-]\d{1,2}[\/\-]\d{1,2}/g, '')
          .replace(/cuota\s*\d+(\s*\/\s*\d+)?/gi, '')
          .replace(/[^a-z0-9]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 3);
        const baseKey = cleanWords.slice(0, 4).join('_');

        const { data: perfil } = await supabase
          .from('perfiles_usuario')
          .select('preferencias')
          .eq('id', userId)
          .maybeSingle();

        const prefs = (perfil && typeof perfil.preferencias === 'object' && perfil.preferencias) ? perfil.preferencias : {};
        const reglas = prefs.reglas_imputacion || {};

        const ruleData = {
          id_cuenta: targetAccountId,
          id_categoria: targetCategoriaId,
          descripcion_ejemplo: descRaw,
          updated_at: new Date().toISOString()
        };

        if (policyId) {
          reglas['pol_' + policyId] = ruleData;
        }
        if (baseKey && baseKey.length >= 3) {
          reglas['desc_' + baseKey] = ruleData;
        }

        prefs.reglas_imputacion = reglas;
        await supabase
          .from('perfiles_usuario')
          .upsert({ id: userId, preferencias: prefs, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      } catch (prefErr) {
        console.warn('[updateConsumoTC] Could not save learned rule in perfiles_usuario:', prefErr.message);
      }
    }

    return res.status(200).json({ success: true, data: {} });
  } catch (err) {
    console.error('[API -> updateConsumoTC]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
