import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

async function run() {
  const envFile = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  const env = Object.fromEntries(
    envFile.split('\n')
      .filter(l => l.includes('='))
      .map(l => l.trim().split('='))
  );

  const arg = process.argv[2];
  let connectionString = process.env.DATABASE_URL || env.DATABASE_URL;

  if (arg && (arg.startsWith('postgres://') || arg.startsWith('postgresql://'))) {
    connectionString = arg;
  } else if (arg) {
    // Password passed as argument
    const projectRef = 'ltmpajstmrcmxezpfusn';
    connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(arg)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
  } else if (env.SUPABASE_DB_PASSWORD) {
    const projectRef = 'ltmpajstmrcmxezpfusn';
    connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
  }

  if (!connectionString) {
    console.error('ERROR: No se encontró DATABASE_URL ni SUPABASE_DB_PASSWORD.');
    console.error('Uso: node run_migration.js "<TU_CONTRASEÑA_DE_SUPABASE_O_DATABASE_URL>"');
    process.exit(1);
  }

  console.log('Conectando a la base de datos PostgreSQL de Supabase...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Conexión establecida con éxito.');

    const sqlPath = path.resolve('setup_supabase_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Ejecutando setup_supabase_schema.sql...');
    await client.query(sql);
    console.log('¡Migración completada exitosamente! Todas las tablas y columnas están sincronizadas.');
  } catch (err) {
    console.error('Error al ejecutar la migración:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
