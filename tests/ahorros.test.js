import test from 'node:test';
import assert from 'node:assert/strict';
import getAhorros from '../api_controllers/getAhorros.js';

function database(rows) {
  return { from(table) {
    const filters = {};
    const result = () => {
      if (table === 'cuentas_principales') return { data: [{ id_cuenta_principal: 'account', nombre: 'QA' }] };
      assert.equal(filters.user_id, 'user');
      assert.equal(filters[table === 'ahorros' ? 'movimientos.id_cuenta_principal' : 'id_cuenta_principal'], 'account');
      return { data: table === 'ahorros' ? rows : [{ id_subcuenta: 'saving', nombre: 'Reserva' }] };
    };
    const q = {
      select(columns) {
        // The production schema has no FK for this optional subaccount field.
        assert.ok(!columns.includes('ahorro_subcuentas(')); return q;
      },
      eq(key, value) { filters[key] = value; return q; },
      lte() { return q; }, order() { return q; },
      range() { return Promise.resolve(result()); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); }
    };
    return q;
  } };
}

async function run(rows) {
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await getAhorros({ method: 'POST', user: { id: 'user' }, body: ['QA', '2026-10-01', '2026-10-31'], db: database(rows) }, res);
  return res;
}

test('savings reads work without an optional subaccount FK and keep historical currency balances', async () => {
  const res = await run([
    { fecha: '2026-09-01', importe: 100, moneda: 'ARS', tipo_transfer: 'DEPOSITO', id_subcuenta: 'saving' },
    { fecha: '2026-10-01', importe: 20, moneda: 'ARS', tipo_transfer: 'RETIRO', id_subcuenta: 'saving' },
    { fecha: '2026-10-02', importe: 5, moneda: 'USD', tipo_transfer: 'DEPOSITO', id_subcuenta: 'unknown' }
  ]);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.kpis, { arsTotal: 80, usdTotal: 5, consolidadoArs: null });
  assert.equal(res.body.transferencias.length, 2);
  assert.equal(res.body.transferencias[0].subcuenta_nombre, 'Reserva');
  assert.equal(res.body.transferencias[1].subcuenta_nombre, 'General');
});

test('an empty savings account returns a successful empty state', async () => {
  const res = await run([]);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.kpis, { arsTotal: 0, usdTotal: 0, consolidadoArs: 0 });
  assert.deepEqual(res.body.transferencias, []);
});
