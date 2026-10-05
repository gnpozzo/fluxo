import createMovimiento from './createMovimiento.js';
import { inputError, validateFinancialInput } from '../api_lib/validation.js';

export default async function handler(req,res) {
  const payload = req.body?.args?.[0] || (Array.isArray(req.body)?req.body[0]:req.body);
  const rows=payload?.movimientos;
  if(!Array.isArray(rows) || !rows.length || rows.length>100) throw inputError('El lote debe tener entre 1 y 100 movimientos.');
  let count=0;
  for(const row of rows) {
    validateFinancialInput(row);
    let status=200,result;
    await createMovimiento({...req,body:row},{status(n){status=n;return this;},json(body){result=body;return this;}});
    if(status>=400 || !result?.success) throw inputError(result?.error || 'No se pudo guardar el lote.',status>=400?status:400);
    count+=result.data.count;
  }
  return res.status(200).json({success:true,data:{count}});
}
