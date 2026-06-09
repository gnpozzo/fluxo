import { getSupabaseClient } from '../api_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const supabase = getSupabaseClient(req);
    const [cuenta, mesYYYYMM] = req.body || [];
    
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
         if (c.cuota_total > 1 && c.cuota_actual === c.cuota_total) {
            notificaciones.push({
               id: c.id_consumo_tarjeta + '_fin',
               tipo: 'info',
               icono: 'check_circle',
               titulo: 'Última Cuota en Tarjeta',
               mensaje: 'El consumo "' + c.descripcion + '" finaliza este mes.',
               importe: c.importe,
               fecha: c.fecha || (trimmed + '-01')
            });
         } else if (c.cuota_total > 1 && c.cuota_actual === 1) {
            notificaciones.push({
               id: c.id_consumo_tarjeta + '_nuevo',
               tipo: 'ingreso',
               icono: 'fiber_new',
               titulo: 'Nuevo Consumo en Cuotas',
               mensaje: 'Inicia la 1° cuota de "' + c.descripcion + '".',
               importe: c.importe,
               fecha: c.fecha || (trimmed + '-01')
            });
         }
      });
    }

    // Fetch active reminders for the account that have APP channel
    const { data: recordatorios, error: recError } = await supabase
      .from('recordatorios')
      .select('*')
      .eq('id_cuenta_principal', cuenta)
      .eq('activa', true)
      .like('canales', '%APP%');

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
            titulo: 'Recordatorio',
            mensaje: r.mensaje,
            importe: 0,
            fecha: computedDateStr
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

