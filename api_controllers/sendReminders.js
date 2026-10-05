import { createClient } from '@supabase/supabase-js';
import { getPool } from '../api_lib/transaction.js';
import { addMonthsSafe, todayArgentina } from '../shared/finance.js';
import crypto from 'node:crypto';

export function nextReminderDate(reminder) {
  if(reminder.frecuencia==='UNICA') return null;
  const date=addMonthsSafe(reminder.fecha_proxima.slice(0,7)+'-01',1);
  const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  if(reminder.frecuencia==='MENSUAL') date.setUTCDate(Math.min(Math.max(Number(reminder.dia_mes)||1,1),last));
  else if(reminder.frecuencia==='DIAS_HABILES') {
    let count=0,lastWorking=1; const target=Number(reminder.dia_habil)||5;
    for(let day=1;day<=last;day++){date.setUTCDate(day);if(![0,6].includes(date.getUTCDay())){count++;lastWorking=day;}if(count===target)break;}
    if(count<target)date.setUTCDate(lastWorking);
  } else throw new Error('Frecuencia inválida.');
  return date.toISOString().slice(0,10);
}

export default async function handler(req,res) {
  if(req.method!=='GET') return res.status(405).json({success:false,error:'Method Not Allowed'});
  const secret=process.env.CRON_SECRET, expected=Buffer.from('Bearer '+(secret||'')),received=Buffer.from(req.headers?.authorization||'');
  if(!secret || expected.length!==received.length || !crypto.timingSafeEqual(expected,received))return res.status(401).json({success:false,error:'Unauthorized'});
  const client=await getPool().connect();
  let locked=false;
  const lease=crypto.randomUUID();
  try {
    locked=(await client.query("INSERT INTO fluxo_private.cron_locks(name,lease,expires_at) VALUES('reminders',$1,now()+interval '5 minutes') ON CONFLICT(name) DO UPDATE SET lease=EXCLUDED.lease,expires_at=EXCLUDED.expires_at WHERE cron_locks.expires_at < now() RETURNING name",[lease])).rows.length>0;
    if(!locked)return res.status(200).json({success:true,processed:0,message:'Already running'});
    const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
    const {data:reminders,error}=await db.from('recordatorios').select('*').eq('activa',true).lte('fecha_proxima',todayArgentina());
    if(error)throw error;
    let processed=0,failed=0;
    for(const reminder of reminders){
      if(!reminder.canales?.toUpperCase().includes('TELEGRAM') || !reminder.chat_id){failed++;continue;}
      const params=[reminder.id_recordatorio,reminder.fecha_proxima];
      const {rows:claimed}=await client.query("INSERT INTO fluxo_private.reminder_delivery(id_recordatorio,due_date) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING status",params);
      const status=claimed[0]?.status || (await client.query('SELECT status FROM fluxo_private.reminder_delivery WHERE id_recordatorio=$1 AND due_date=$2',params)).rows[0]?.status;
      // Pending means the outcome of an earlier delivery is uncertain. Reconcile
      // it before retrying; a timeout must not silently duplicate a reminder.
      if(!claimed.length && status!=='sent'){failed++;continue;}
      try {
        const next=nextReminderDate(reminder);
        if(status!=='sent'){
          const response=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:reminder.chat_id,text:'🔔 Recordatorio financiero\n\n'+reminder.mensaje}),signal:AbortSignal.timeout(10000)});
          const result=await response.json();
          if(!response.ok || !result.ok){await client.query("DELETE FROM fluxo_private.reminder_delivery WHERE id_recordatorio=$1 AND due_date=$2",params);throw new Error('Telegram rechazó el envío.');}
          await client.query("UPDATE fluxo_private.reminder_delivery SET status='sent',updated_at=now() WHERE id_recordatorio=$1 AND due_date=$2",params);
        }
        const {error:saveError}=await db.from('recordatorios').update({fecha_proxima:next,activa:next!==null}).eq('id_recordatorio',reminder.id_recordatorio).eq('fecha_proxima',reminder.fecha_proxima);
        if(saveError)throw saveError;
        processed++;
      }catch(error){failed++;console.error('[Reminder]',reminder.id_recordatorio,error.message);}
    }
    return res.status(200).json({success:true,processed,failed});
  }catch(error){console.error('[Reminders]',error.message);return res.status(500).json({success:false,error:'No se pudieron procesar los recordatorios.'});}
  finally {if(locked)await client.query("DELETE FROM fluxo_private.cron_locks WHERE name='reminders' AND lease=$1",[lease]);client.release();}
}
