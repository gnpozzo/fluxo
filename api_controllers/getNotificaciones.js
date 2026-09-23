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
      finalArgs = [req.body.cuenta, req.body.mes];
    }
    let [cuenta, mesYYYYMM] = finalArgs;

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'No autenticado' });

    if (cuenta) {
      const resolvedCuenta = await resolveUserCuenta(supabase, cuenta, userId);
      if (!resolvedCuenta) return res.status(403).json({ success: false, error: 'Acceso denegado: La cuenta no pertenece al usuario autenticado.' });
      cuenta = resolvedCuenta;
    }
    
    const notificaciones = [];
    if (!mesYYYYMM || typeof mesYYYYMM !== 'string') {
      return res.status(200).json({ success: true, data: notificaciones });
    }
    
    const trimmed = String(mesYYYYMM).trim();
    const parts = trimmed.split('-');
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    
    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
      return res.status(200).json({ success: true, data: notificaciones });
    }
    
    const dateStart = trimmed + '-01';
    const endM = new Date(Date.UTC(y, m, 0));
    const dateEnd = endM.toISOString().split('T')[0];

    const { data: consumos, error } = await supabase.rpc('get_consumos_tc_list', {
      p_id_cuenta: cuenta,
      p_fecha_inicio: dateStart,
      p_fecha_fin: dateEnd
    });

    if (error) throw error;

    if (consumos && consumos.length > 0) {
      consumos.forEach(c => {
         const cuotaTot = Number(c.cuota_total || 1);
         const cuotaAct = Number(c.cuota_actual || 1);
         const isRecur = c.tipo_consumo === 'RECURRENTE' || c.recur_group_id?.startsWith('REC_');

         if (cuotaTot > 1 && cuotaAct === cuotaTot) {
            notificaciones.push({
               id: c.id_consumo_tarjeta + '_fin',
               tipo: 'info',
               icono: 'check_circle',
               categoria: 'cuotas',
               titulo: 'Última Cuota en Tarjeta',
               mensaje: 'El consumo "' + c.descripcion + '" finaliza este mes.',
               importe: c.importe,
               fecha: c.fecha || (trimmed + '-01'),
               tipo_entidad: 'consumo_tc',
               id_entidad: c.id_consumo_tarjeta
            });
         } else if (cuotaTot > 1 && cuotaAct === 1) {
            notificaciones.push({
               id: c.id_consumo_tarjeta + '_nuevo',
               tipo: 'ingreso',
               icono: 'fiber_new',
               categoria: 'cuotas',
               titulo: 'Nuevo Consumo en Cuotas',
               mensaje: 'Inicia la 1° cuota de "' + c.descripcion + '".',
               importe: c.importe,
               fecha: c.fecha || (trimmed + '-01'),
               tipo_entidad: 'consumo_tc',
               id_entidad: c.id_consumo_tarjeta
            });
         } else if (cuotaTot <= 1 && !isRecur) {
            notificaciones.push({
               id: c.id_consumo_tarjeta + '_unica',
               tipo: 'info',
               icono: 'credit_card',
               categoria: 'cuotas',
               titulo: 'Consumo Única Cuota (TC)',
               mensaje: 'Consumo al contado: "' + c.descripcion + '".',
               importe: c.importe,
               fecha: c.fecha || (trimmed + '-01'),
               tipo_entidad: 'consumo_tc',
               id_entidad: c.id_consumo_tarjeta
            });
         }
      });
    }

    // Fetch movements of the account in the month for cuota notifications
    if (cuenta) {
      const { data: movs, error: movsErr } = await supabase
        .from('movimientos')
        .select('id_movimiento, fecha, descripcion, importe, tipo_mov, recur_group_id')
        .eq('id_cuenta_principal', cuenta)
        .eq('tipo_mov', 'EGRESO')
        .gte('fecha', dateStart)
        .lte('fecha', dateEnd);

      if (!movsErr && movs && movs.length > 0) {
        movs.forEach(m => {
          const desc = m.descripcion || '';
          const matchCuota = desc.match(/\(Cuota\s+(\d+)\/(\d+)\)/i) || desc.match(/\((\d+)\/(\d+)\)/);
          if (matchCuota) {
            const act = parseInt(matchCuota[1], 10);
            const tot = parseInt(matchCuota[2], 10);
            if (tot > 1 && act === tot) {
              notificaciones.push({
                id: m.id_movimiento + '_fin_gasto',
                tipo: 'info',
                icono: 'check_circle',
                categoria: 'cuotas',
                titulo: 'Última Cuota de Gasto',
                mensaje: 'Finaliza el pago de cuotas de "' + desc + '".',
                importe: m.importe,
                fecha: m.fecha || (trimmed + '-01'),
                tipo_entidad: 'movimiento',
                id_entidad: m.id_movimiento
              });
            }
          } else if (!m.recur_group_id?.startsWith('REC_') && !desc.toLowerCase().includes('reintegro tc')) {
            notificaciones.push({
              id: m.id_movimiento + '_unica_gasto',
              tipo: 'info',
              icono: 'receipt',
              categoria: 'cuotas',
              titulo: 'Gasto en Única Cuota',
              mensaje: 'Pago registrado: "' + desc + '".',
              importe: m.importe,
              fecha: m.fecha || (trimmed + '-01'),
              tipo_entidad: 'movimiento',
              id_entidad: m.id_movimiento
            });
          }
        });
      }
    }

    // Fetch active reminders for the account (APP or Telegram or all)
    let recQuery = supabase
      .from('recordatorios')
      .select('*')
      .eq('activa', true)
      .or('canales.ilike.%APP%,canales.ilike.%TELEGRAM%,canales.is.null');

    if (cuenta) {
      recQuery = recQuery.or(`id_cuenta_principal.eq.${cuenta},id_cuenta_principal.is.null`);
    }

    const { data: recordatorios, error: recError } = await recQuery;

    if (recError) throw recError;

    if (recordatorios && recordatorios.length > 0) {
      recordatorios.forEach(r => {
        let computedDateStr = null;
        if (r.frecuencia === 'UNICA') {
          if (r.fecha_proxima && r.fecha_proxima.startsWith(trimmed)) {
            computedDateStr = r.fecha_proxima;
          }
        } else if (r.frecuencia === 'MENSUAL') {
          computedDateStr = `${trimmed}-${String(r.dia_mes || 1).padStart(2, '0')}`;
        } else if (r.frecuencia === 'DIAS_HABILES') {
          const targetWorkingDay = r.dia_habil || 5;
          const matchedDate = getWorkingDayDate(y, m, targetWorkingDay);
          if (matchedDate) {
            computedDateStr = matchedDate.toISOString().split('T')[0];
          } else {
            computedDateStr = `${trimmed}-01`;
          }
        }

        if (computedDateStr) {
          notificaciones.push({
            id: r.id_recordatorio + '_' + trimmed,
            tipo: 'info',
            icono: 'clock',
            categoria: 'recordatorios',
            titulo: 'Recordatorio' + (r.chat_id || r.canales?.includes('TELEGRAM') ? ' (Bot)' : ''),
            mensaje: r.mensaje,
            importe: 0,
            fecha: computedDateStr,
            tipo_entidad: 'recordatorio',
            id_entidad: r.id_recordatorio
          });
        }
      });
    }

    return res.status(200).json({ success: true, data: notificaciones });
  } catch (err) {
    console.error('[API -> getNotificaciones Error]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

function getWorkingDayDate(year, month, targetWorkingDay) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDaysCount = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const checkD = new Date(year, month - 1, day);
    const dayOfWeek = checkD.getDay(); // 0 is Sunday, 6 is Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDaysCount++;
      if (workingDaysCount === targetWorkingDay) {
        return checkD;
      }
    }
  }
  return null;
}

