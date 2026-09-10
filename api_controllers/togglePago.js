import { getSupabaseClient } from '../api_lib/supabase.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    let body = req.body;
    if (body && Array.isArray(body.args)) {
      body = body.args[0] || {};
    }

    const { action = 'toggle', idMovimiento, idTarjeta, mes, pagado, fechaPago, ids: rawIds } = body || {};

    // 1. Obtener registro de estado de pagos del usuario
    const { data: logRows } = await supabase
      .from('logs')
      .select('id, contexto')
      .eq('funcion', 'ESTADO_PAGOS')
      .eq('mensaje', userId)
      .limit(1);

    let logId = logRows?.[0]?.id || null;
    let pagosMap = logRows?.[0]?.contexto || {};

    if (action === 'get_state') {
      return res.status(200).json({ success: true, data: pagosMap });
    }

    const todayStr = fechaPago || new Date().toISOString().split('T')[0];
    let lastStatus = false;
    let updatedCount = 0;

    if (action === 'toggle') {
      const rawId = idMovimiento || body.id || body.idConsumo;
      if (!rawId) {
        return res.status(400).json({ success: false, error: 'id requerido' });
      }
      const ids = Array.isArray(rawId) ? rawId : [rawId];
      ids.forEach(id => {
        const currentlyPaid = !!pagosMap[id]?.pagado;
        const newStatus = (pagado !== undefined) ? !!pagado : !currentlyPaid;
        pagosMap[id] = {
          pagado: newStatus,
          fecha_pago: newStatus ? todayStr : null
        };
        lastStatus = newStatus;
        updatedCount++;
      });

      // Sincronizar bidireccionalmente entre consumos_tc y movimientos vinculados
      const idsToCheck = ids.filter(Boolean);
      if (idsToCheck.length > 0) {
        // Si son consumos_tc, buscar movimientos vinculados
        const { data: linkedMovs } = await supabase
          .from('movimientos')
          .select('id_movimiento, id_consumo_tarjeta_origen')
          .in('id_consumo_tarjeta_origen', idsToCheck)
          .eq('user_id', userId);
        (linkedMovs || []).forEach(m => {
          pagosMap[m.id_movimiento] = {
            pagado: lastStatus,
            fecha_pago: lastStatus ? todayStr : null,
            tipo: 'MOV_FROM_TC'
          };
        });

        // Si son movimientos vinculados a consumos_tc, sincronizar el consumo origen
        const { data: movsWithTc } = await supabase
          .from('movimientos')
          .select('id_movimiento, id_consumo_tarjeta_origen')
          .in('id_movimiento', idsToCheck)
          .eq('user_id', userId)
          .not('id_consumo_tarjeta_origen', 'is', null);
        (movsWithTc || []).forEach(m => {
          if (m.id_consumo_tarjeta_origen) {
            pagosMap[m.id_consumo_tarjeta_origen] = {
              pagado: lastStatus,
              fecha_pago: lastStatus ? todayStr : null,
              tipo: 'TC_FROM_MOV'
            };
          }
        });
      }

    } else if (action === 'pagar_resumen') {
      let tcIds = Array.isArray(rawIds) && rawIds.length > 0 ? rawIds : [];

      // Si no vienen IDs directamente, buscar consumos por idTarjeta y mes
      if (tcIds.length === 0 && idTarjeta && mes) {
        const [y, m] = mes.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const start = `${mes}-01`;
        const end = `${mes}-${String(lastDay).padStart(2, '0')}`;

        const { data: consumos } = await supabase
          .from('consumos_tc')
          .select('id_consumo_tarjeta')
          .eq('id_tarjeta', idTarjeta)
          .eq('user_id', userId)
          .gte('fecha', start)
          .lte('fecha', end);

        tcIds = (consumos || []).map(c => c.id_consumo_tarjeta);
      }

      // Obtener detalles de la tarjeta y cuentas para crear los movimientos contables
      let cardAccountId = null;
      let cardNombre = 'Tarjeta';
      let cardVto = null;
      if (idTarjeta) {
        const { data: tc } = await supabase
          .from('tarjetas')
          .select('id_tarjeta, nombre, id_cuenta_principal, fecha_vencimiento_actual')
          .eq('id_tarjeta', idTarjeta)
          .eq('user_id', userId)
          .maybeSingle();
        if (tc) {
          cardAccountId = tc.id_cuenta_principal;
          cardNombre = tc.nombre || 'Tarjeta de Crédito';
          cardVto = tc.fecha_vencimiento_actual;
        }
      }

      // Obtener cuenta Hogar
      const { data: allCuentas } = await supabase
        .from('cuentas_principales')
        .select('id_cuenta_principal, nombre')
        .eq('user_id', userId);
      const hogarCuenta = (allCuentas || []).find(c => c.nombre.toLowerCase().includes('hogar'));
      const hogarId = hogarCuenta?.id_cuenta_principal || null;

      // Obtener los consumos completos para calcular el total a pagar
      let totalAPagar = 0;
      if (tcIds.length > 0) {
        const { data: cData } = await supabase
          .from('consumos_tc')
          .select('importe, moneda')
          .in('id_consumo_tarjeta', tcIds)
          .eq('user_id', userId);
        (cData || []).forEach(c => {
          if (c.moneda !== 'USD') {
            totalAPagar += Number(c.importe || 0);
          }
        });
      }

      // Obtener movimientos asociados a estos consumos
      let movsVinculados = [];
      if (tcIds.length > 0) {
        const { data: movs } = await supabase
          .from('movimientos')
          .select('*')
          .in('id_consumo_tarjeta_origen', tcIds)
          .eq('user_id', userId);
        movsVinculados = movs || [];
      }

      const paymentDate = todayStr || cardVto || new Date().toISOString().split('T')[0];

      // 1. Débito del total del resumen en la cuenta titular de la tarjeta (Personal)
      if (cardAccountId && totalAPagar > 0) {
        const descPago = `Pago Resumen: ${cardNombre}`;
        // Verificar si ya existe el movimiento de pago para evitar duplicados
        const { data: existingPayment } = await supabase
          .from('movimientos')
          .select('id_movimiento')
          .eq('id_cuenta_principal', cardAccountId)
          .eq('tipo_mov', 'EGRESO')
          .eq('descripcion', descPago)
          .gte('fecha', paymentDate.substring(0, 7) + '-01')
          .lte('fecha', paymentDate.substring(0, 7) + '-31')
          .eq('user_id', userId);

        let paymentMovId = existingPayment?.[0]?.id_movimiento;

        if (!paymentMovId) {
          const newPaymentMov = {
            id_movimiento: crypto.randomUUID(),
            id_cuenta_principal: cardAccountId,
            user_id: userId,
            fecha: paymentDate,
            id_categoria: 'CAT_SERVICIOS',
            tipo_mov: 'EGRESO',
            descripcion: descPago,
            importe: Math.round(totalAPagar * 100) / 100,
            moneda: 'ARS',
            medio_pago: 'Débito Automático'
          };
          const { data: insertedMov } = await supabase
            .from('movimientos')
            .insert([newPaymentMov])
            .select('id_movimiento');
          paymentMovId = insertedMov?.[0]?.id_movimiento;
        }

        if (paymentMovId) {
          pagosMap[paymentMovId] = { pagado: true, fecha_pago: paymentDate, tipo: 'PAGO_TC' };
        }
      }

      // 2. Si los egresos de Hogar estaban fechados en el mes de compra anterior,
      // sincronizar su fecha al mes del pago/vencimiento para que figuren en Hogar en el período de pago
      if (hogarId) {
        const hogarMovsToAlign = movsVinculados.filter(m => m.id_cuenta_principal === hogarId && m.tipo_mov === 'EGRESO' && m.fecha < paymentDate.substring(0, 7) + '-01');
        for (const hm of hogarMovsToAlign) {
          await supabase
            .from('movimientos')
            .update({ fecha: paymentDate })
            .eq('id_movimiento', hm.id_movimiento)
            .eq('user_id', userId);
          hm.fecha = paymentDate;
        }
      }

      // 3. Marcar todos los consumos y movimientos asociados como Saldados
      tcIds.forEach(id => {
        pagosMap[id] = { pagado: true, fecha_pago: paymentDate, tipo: 'TC' };
        updatedCount++;
      });
      movsVinculados.forEach(m => {
        pagosMap[m.id_movimiento] = { pagado: true, fecha_pago: paymentDate, tipo: 'MOV' };
      });

      if (idTarjeta && mes) {
        pagosMap[`RESUMEN_${idTarjeta}_${mes}`] = { pagado: true, fecha_pago: paymentDate };
      }
      lastStatus = true;
    }

    // 2. Persistir en Supabase
    if (logId) {
      await supabase
        .from('logs')
        .update({ contexto: pagosMap, timestamp: new Date().toISOString() })
        .eq('id', logId);
    } else {
      const { data: newLog } = await supabase
        .from('logs')
        .insert([{
          nivel: 'INFO',
          funcion: 'ESTADO_PAGOS',
          mensaje: userId,
          contexto: pagosMap,
          timestamp: new Date().toISOString()
        }])
        .select('id');
      logId = newLog?.[0]?.id;
    }

    return res.status(200).json({
      success: true,
      pagado: lastStatus,
      updatedCount,
      data: pagosMap
    });

  } catch (err) {
    console.error('[API -> togglePago -> ERROR]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
