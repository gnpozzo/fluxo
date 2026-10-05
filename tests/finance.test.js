import test from 'node:test';
import assert from 'node:assert/strict';
import { civilDate,addMonthsSafe,monthBounds,sharedBalance,holdings,allocateMoney } from '../shared/finance.js';
import { validateFinancialInput } from '../api_lib/validation.js';
import { nextReminderDate } from '../api_controllers/sendReminders.js';

test('month-end installments retain their anchor and respect leap years',()=>{
  assert.equal(addMonthsSafe('2026-01-31',1).toISOString().slice(0,10),'2026-02-28');
  assert.equal(addMonthsSafe('2026-01-31',2).toISOString().slice(0,10),'2026-03-31');
  assert.equal(addMonthsSafe('2024-01-31',1).toISOString().slice(0,10),'2024-02-29');
  assert.deepEqual(monthBounds('2026-02'),['2026-02-01','2026-02-28']);
  assert.throws(()=>civilDate('2026-02-30'));
});
test('shared expenses calculate the other party share when I pay, including zero',()=>{
  assert.deepEqual(sharedBalance(100,25,'YO'),{own:25,balance:75});
  assert.deepEqual(sharedBalance(100,0,'YO'),{own:0,balance:100});
  assert.deepEqual(sharedBalance(100,25,'OTRO'),{own:25,balance:-25});
});
test('split allocation preserves every cent when shares consume 100 percent',()=>{
  assert.deepEqual(allocateMoney(0.05,[50,50]),[0.03,0.02]);
  const parts=allocateMoney(100.01,[33.33,33.33,33.34]);
  assert.equal(Math.round(parts.reduce((a,b)=>a+b,0)*100),10001);
});
test('moving average removes sold cost before a later purchase and separates currencies',()=>{
  const op=(fecha,tipo_operacion,cantidad_nominales,importe_total_ars,moneda='ARS')=>({fecha,tipo_operacion,cantidad_nominales,importe_total_ars,moneda,ticker:'ABC'});
  const result=holdings([op('2026-03-01','COMPRA',10,2000),op('2026-01-01','COMPRA',10,1000),op('2026-02-01','VENTA',5,750),op('2026-04-01','COMPRA',2,500,'USD')]);
  assert.equal(result[0].quantity,15);assert.equal(result[0].costArs,2500);assert.equal(result[0].realizedArs,250);
  assert.equal(result.length,2);
  assert.throws(()=>holdings([op('2026-01-01','VENTA',1,100)]));
});
test('financial validation rejects invalid values before any delete or write',()=>{
  for(const importe of [-1,0,Infinity,'NaN']) assert.throws(()=>validateFinancialInput({importe}));
  assert.throws(()=>validateFinancialInput({tipoConsumo:'CUOTAS',cuotaActual:3,cuotaTotal:2}));
  assert.throws(()=>validateFinancialInput({splitDestinos:[{cuenta:'a',pct:60},{cuenta:'b',pct:60}]}));
  assert.throws(()=>validateFinancialInput({scope:'MONTH'}));
  const value=validateFinancialInput({tipo:'CUOTAS',cuotaActual:'1',cuotaTotal:'3',importe:'10'});
  assert.equal(value.cuotaActual,1);assert.equal(value.importe,10);
});
test('monthly reminders clamp day 31 and working weekdays do not overflow',()=>{
  assert.equal(nextReminderDate({fecha_proxima:'2026-01-31',frecuencia:'MENSUAL',dia_mes:31}),'2026-02-28');
  assert.equal(nextReminderDate({fecha_proxima:'2026-01-31',frecuencia:'DIAS_HABILES',dia_habil:5}),'2026-02-06');
  assert.equal(nextReminderDate({fecha_proxima:'2026-01-31',frecuencia:'DIAS_HABILES',dia_habil:23}),'2026-02-27');
  assert.equal(nextReminderDate({frecuencia:'UNICA'}),null);
});
