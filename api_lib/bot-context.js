import { AsyncLocalStorage } from 'node:async_hooks';
import { atomicRequest } from './transaction.js';
import { validateFinancialInput } from './validation.js';

export const botContext = new AsyncLocalStorage();
export async function botWrite(handler, payload, res, endpoint) {
  const context = botContext.getStore();
  if (!context?.user) throw new Error('Falta la identidad vinculada de Telegram.');
  validateFinancialInput(payload);
  const request = { method:'POST', body:payload, user:context.user, headers:{'idempotency-key':`telegram:${context.updateId}:${context.writeIndex++}`} };
  return atomicRequest(request,res,handler,endpoint);
}

// The service key is needed for bot session storage only. Every business query
// is explicitly scoped to the linked owner and writes cannot change that owner.
export function scopedBotClient(client, userId) {
  return { from(table) {
    const builder = client.from(table);
    if(table === 'bot_sessions') return builder;
    const filter = query => table==='categorias' ? query.or(`user_id.is.null,user_id.eq.${userId}`) : query.eq(table==='perfiles_usuario'?'id':'user_id',userId);
    return {
      select(...args) { return filter(builder.select(...args)); },
      update(row) { return filter(builder.update({...row,...(table==='perfiles_usuario'?{id:userId}:{user_id:userId})})); },
      delete() { return filter(builder.delete()); },
      insert(rows) { const scoped=r=>({...r,...(table==='perfiles_usuario'?{id:userId}:{user_id:userId})}); return builder.insert(Array.isArray(rows)?rows.map(scoped):scoped(rows)); },
      upsert(rows,options) { const scoped=r=>({...r,...(table==='perfiles_usuario'?{id:userId}:{user_id:userId})}); return builder.upsert(Array.isArray(rows)?rows.map(scoped):scoped(rows),options); }
    };
  }};
}
