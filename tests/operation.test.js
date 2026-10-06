import test from 'node:test';
import assert from 'node:assert/strict';
import { operationInfo, isCardPurchase, canTogglePayment } from '../shared/operation.js';

test('legacy suffix and explicit installment metadata produce a single badge', () => {
  assert.deepEqual(operationInfo({descripcion:'Calzado (3/6)'}), {description:'Calzado',label:'Cuota 3/6',current:3,total:6});
  assert.equal(operationInfo({descripcion:'Calzado',cuota_actual:6,cuota_total:6}).label,'Última cuota');
  assert.equal(operationInfo({descripcion:'Calzado (Cuota 3/6)',cuota_actual:4,cuota_total:6}).label,'Cuota 4/6');
  assert.equal(operationInfo({descripcion:'Servicio (Cuota 1/12)',recur_group_id:'REC_test'}).label,'Recurrente');
  assert.equal(operationInfo({descripcion:'Compra'}).label,'Simple');
  assert.equal(operationInfo({descripcion:'Plan (3/6) adicional'}).description,'Plan (3/6) adicional');
  assert.equal(operationInfo({descripcion:'Prueba (8/3)'}).description,'Prueba (8/3)');
});

test('debit, transfer and cash permit manual payment; credit purchases do not', () => {
  for (const medio_pago of ['Tarjeta de Débito','Débito automático','Transferencia','Efectivo']) {
    assert.equal(canTogglePayment({tipo_mov:'EGRESO',medio_pago}),true);
  }
  for (const medio_pago of ['Tarjeta de Crédito','Tarjeta','TC']) assert.equal(isCardPurchase({medio_pago}),true);
  assert.equal(canTogglePayment({tipo_mov:'EGRESO',medio_pago:'Transferencia',id_consumo_tarjeta_origen:'purchase'}),false);
  assert.equal(canTogglePayment({tipo_mov:'INGRESO',medio_pago:'Efectivo'}),false);
  assert.equal(canTogglePayment({tipo_mov:'EGRESO',medio_pago:'Transferencia',descripcion:'Pago Resumen: Visa'}),false);
});
