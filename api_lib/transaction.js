import pg from 'pg';
import crypto from 'node:crypto';
import { supabaseCa } from './supabase-ca.js';

// DATE is a civil calendar value; pg's default Date conversion changes the
// PostgREST contract and can shift the day with the server timezone.
pg.types.setTypeParser(1082, value => value);

const keys = { cuentas_principales: 'id_cuenta_principal', tarjetas: 'id_tarjeta', categorias: 'id_categoria', ahorro_subcuentas: 'id_subcuenta', cta_corriente_usuarios: 'id_usuario', movimientos: 'id_movimiento', consumos_tc: 'id_consumo_tarjeta', cc_consumos: 'id_cc_consumo', ahorros: 'id_ahorro', inversiones_movimientos: 'id_inversion_mov', recordatorios: 'id_recordatorio', perfiles_usuario: 'id', logs: 'id', cotizaciones_dolar: 'id', cotizaciones: 'id' };
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error('Identificador SQL inválido.'); return `"${s}"`; };
let pool;
export function getPool() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('Falta DATABASE_URL para operaciones transaccionales.'), { status: 503 });
  pool ||= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 8000, idleTimeoutMillis: 10000, ssl: { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT || supabaseCa } });
  return pool;
}

// Restricted PostgREST-compatible query surface for existing write controllers.
// Values are always parameters; identifiers/operators are allowlisted. Errors
// poison the transaction even if a legacy controller tries to swallow them.
export class TransactionQuery {
  constructor(db, table) {
    if (!Object.hasOwn(keys, table)) throw new Error('Tabla no admitida.');
    this.db = db; this.table = table; this.action = 'select'; this.columns = '*'; this.filters = []; this.sort = []; this.values = []; this.returning = false; this.cardinality = null;
  }
  param(v) { this.values.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v); return `$${this.values.length}`; }
  select(columns = '*', options = {}) { this.columns = columns; this.options = options; if (this.action !== 'select') this.returning = true; return this; }
  insert(rows) { this.action = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, options = {}) { this.insert(rows); this.action = 'upsert'; this.conflict = options.onConflict || keys[this.table]; return this; }
  update(row) { this.action = 'update'; this.rows = [row]; return this; }
  delete() { this.action = 'delete'; return this; }
  filter(column, operator, value) { this.filters.push(`${ident(column)} ${operator} ${this.param(value)}`); return this; }
  eq(c, v) { return v === null ? this.is(c, null) : this.filter(c, '=', v); }
  neq(c, v) { return this.filter(c, '<>', v); }
  gt(c, v) { return this.filter(c, '>', v); }
  gte(c, v) { return this.filter(c, '>=', v); }
  lt(c, v) { return this.filter(c, '<', v); }
  lte(c, v) { return this.filter(c, '<=', v); }
  like(c, v) { return this.filter(c, 'LIKE', v); }
  ilike(c, v) { return this.filter(c, 'ILIKE', v); }
  in(c, values) { if (!Array.isArray(values)) throw new Error('Lista inválida.'); this.filters.push(values.length ? `${ident(c)} IN (${values.map(v => this.param(v)).join(',')})` : 'FALSE'); return this; }
  is(c, v) { if (v !== null && typeof v !== 'boolean') throw new Error('Filtro inválido.'); this.filters.push(`${ident(c)} IS ${v === null ? 'NULL' : v ? 'TRUE' : 'FALSE'}`); return this; }
  not(c, op, v) { if (op !== 'is' || v !== null) throw new Error('Filtro no admitido.'); this.filters.push(`${ident(c)} IS NOT NULL`); return this; }
  or(expression) {
    const clauses = expression.split(',').map(part => {
      const [column, op, ...rest] = part.split('.'); const value = rest.join('.');
      if (op === 'is' && value === 'null') return `${ident(column)} IS NULL`;
      if (op !== 'eq') throw new Error('Filtro OR inválido.');
      return `${ident(column)} = ${this.param(value)}`;
    }); this.filters.push(`(${clauses.join(' OR ')})`); return this;
  }
  order(c, opts = {}) { this.sort.push(`${ident(c)} ${opts.ascending === false ? 'DESC' : 'ASC'}`); return this; }
  limit(n) { if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error('Límite inválido.'); this.maxRows = n; return this; }
  single() { this.cardinality = 'one'; return this; }
  maybeSingle() { this.cardinality = 'optional'; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  async execute() {
    try {
      const table = `public.${ident(this.table)}`;
      const columns = this.columns === '*' ? '*' : this.columns.split(',').map(c => ident(c.trim())).join(',');
      const where = this.filters.length ? ` WHERE ${this.filters.join(' AND ')}` : '';
      let sql;
      if (this.action === 'select') {
        sql = `SELECT ${this.options?.count ? 'count(*) OVER() AS __count,' : ''}${columns} FROM ${table}${where}`;
        if (this.sort.length) sql += ` ORDER BY ${this.sort.join(',')}`;
        if (this.maxRows !== undefined) sql += ` LIMIT ${this.maxRows}`;
      } else if (this.action === 'delete') {
        if (!where) throw new Error('Borrado sin filtros rechazado.');
        sql = `DELETE FROM ${table}${where}`;
      } else if (this.action === 'update') {
        if (!where) throw new Error('Actualización sin filtros rechazada.');
        const entries = Object.entries(this.rows[0]).filter(([, v]) => v !== undefined);
        sql = `UPDATE ${table} SET ${entries.map(([k, v]) => `${ident(k)}=${this.param(v)}`).join(',')}${where}`;
      } else {
        if (!this.rows.length) return { data: [], error: null };
        const fields = [...new Set(this.rows.flatMap(r => Object.keys(r).filter(k => r[k] !== undefined)))];
        sql = `INSERT INTO ${table} (${fields.map(ident).join(',')}) VALUES ${this.rows.map(r => `(${fields.map(k => r[k] === undefined ? 'DEFAULT' : this.param(r[k])).join(',')})`).join(',')}`;
        if (this.action === 'upsert') {
          const conflict = this.conflict.split(',').map(c => c.trim());
          const updates = fields.filter(k => !conflict.includes(k));
          sql += ` ON CONFLICT (${conflict.map(ident).join(',')}) ${updates.length ? `DO UPDATE SET ${updates.map(k => `${ident(k)}=EXCLUDED.${ident(k)}`).join(',')}` : 'DO NOTHING'}`;
        }
      }
      if (this.action !== 'select' && this.returning) sql += ` RETURNING ${columns}`;
      const result = await this.db.client.query(sql, this.values);
      let data = result.rows;
      for (const row of data) for (const [key,value] of Object.entries(row)) if(value instanceof Date) row[key]=value.toISOString();
      const count = this.options?.count ? Number(data[0]?.__count || 0) : null;
      data.forEach(r => { delete r.__count; });
      if (this.cardinality) {
        if (data.length > 1 || (this.cardinality === 'one' && data.length !== 1)) throw new Error('Cantidad de registros inesperada.');
        data = data[0] || null;
      }
      return { data: this.options?.head ? null : data, error: null, count };
    } catch (error) { this.db.failed = true; if (error.code === '42501') error.status = 403; else if (['23503','23505','23514','22P02','22007','22008'].includes(error.code)) error.status = 400; throw error; }
  }
}

export async function atomicRequest(req, res, handler, endpoint, poolOverride) {
  const client = await (poolOverride || getPool()).connect();
  const db = { client, failed: false, from(table) { return new TransactionQuery(this, table); } };
  const userId = req.user.id;
  let code = 200, response;
  const buffered = { status(n) { code = n; return this; }, json(body) { response = body; return this; } };
  const key = req.headers?.['idempotency-key'];
  const hash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15000'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
    if (key) {
      if (!/^[\w:.-]{1,160}$/.test(key)) throw Object.assign(new Error('Idempotency-Key inválida.'), { status: 400 });
      const cached = await client.query('SELECT request_hash,status,response FROM fluxo_private.requests WHERE user_id=$1 AND endpoint=$2 AND request_key=$3', [userId, endpoint, key]);
      if (cached.rows.length) {
        if (cached.rows[0].request_hash !== hash) throw Object.assign(new Error('La clave de operación ya fue utilizada con otros datos.'), { status: 409 });
        await client.query('COMMIT');
        return res.status(cached.rows[0].status).json(cached.rows[0].response);
      }
    }
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await client.query('SET LOCAL ROLE authenticated');
    req.db = db;
    await handler(req, buffered);
    if (!response || code >= 400 || response.success === false || db.failed) {
      await client.query('ROLLBACK');
      return res.status(code >= 400 ? code : 500).json(response?.success === false ? response : { success: false, error: 'La operación no se completó.' });
    }
    await client.query('RESET ROLE');
    if (key) await client.query('INSERT INTO fluxo_private.requests(user_id,endpoint,request_key,request_hash,status,response) VALUES($1,$2,$3,$4,$5,$6)', [userId, endpoint, key, hash, code, JSON.stringify(response)]);
    await client.query('COMMIT');
    return res.status(code).json(response);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { delete req.db; client.release(); }
}
