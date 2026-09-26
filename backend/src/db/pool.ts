import pg from 'pg';
import { config } from '../config.js';

// Los enteros de 64 bits (COUNT, BIGSERIAL) llegan como string por defecto.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// DATE como string 'YYYY-MM-DD' (sin conversión a zona horaria local).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export type Db = Pick<pg.PoolClient, 'query'>;

const SQL_LOG = process.env.SQL_LOG !== 'off';

function compact(sql: string): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine;
}

/**
 * Ejecuta una consulta y la registra en consola con una etiqueta.
 * Los logs permiten demostrar en el video cuántas consultas llegan a Supabase.
 */
export async function query<T extends pg.QueryResultRow = any>(
  tag: string,
  sql: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  const started = performance.now();
  const result = await db.query<T>(sql, params);
  // Las consultas de sondeo (poll:*) solo se registran cuando encuentran trabajo.
  if (SQL_LOG && !(tag.startsWith('poll:') && result.rowCount === 0)) {
    const ms = (performance.now() - started).toFixed(0);
    console.log(`  \x1b[2m[SQL ${tag}] ${ms}ms rows=${result.rowCount} :: ${compact(sql)}\x1b[0m`);
  }
  return result.rows;
}

/** Ejecuta `fn` dentro de una transacción; hace ROLLBACK si lanza o si devuelve { rollback: true }. */
export async function withTransaction<T>(fn: (tx: pg.PoolClient) => Promise<T & { rollback?: boolean }>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query(result?.rollback ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
