import mysql from "mysql2/promise";
import {
  ConnectionTarget,
  describeTarget,
  requireActiveTarget,
  withDatabase,
} from "./connections.js";

const MAX_POOLS = 8;
const CONNECT_TIMEOUT_MS = parseInt(process.env.MYSQL_CONNECT_TIMEOUT_MS ?? "10000", 10);
const QUERY_TIMEOUT_MS = parseInt(process.env.MYSQL_QUERY_TIMEOUT_MS ?? "30000", 10);

const pools = new Map<string, mysql.Pool>();

function targetKey(target: ConnectionTarget): string {
  return describeTarget(target);
}

async function evictOldestPool(): Promise<void> {
  if (pools.size <= MAX_POOLS) {
    return;
  }
  const oldest = pools.keys().next();
  if (oldest.done) {
    return;
  }
  const pool = pools.get(oldest.value);
  pools.delete(oldest.value);
  if (pool) {
    await pool.end().catch(() => undefined);
  }
}

async function getPool(target: ConnectionTarget): Promise<mysql.Pool> {
  const key = targetKey(target);
  const existing = pools.get(key);

  if (existing) {
    // Re-insert so the Map iteration order stays least-recently-used first.
    pools.delete(key);
    pools.set(key, existing);
    return existing;
  }

  const pool = mysql.createPool({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    connectionLimit: 3,
    waitForConnections: true,
    multipleStatements: false,
    connectTimeout: CONNECT_TIMEOUT_MS,
    dateStrings: true,
  });

  // Defense in depth under the SQL validator. With autocommit on, every
  // statement becomes its own read-only transaction, so the server itself
  // rejects a write with error 1792 even if the validator were bypassed.
  pool.on("connection", (connection) => {
    connection.query("SET SESSION TRANSACTION READ ONLY", (error: unknown) => {
      if (error) {
        console.error(`[mcp-mysql-ro] could not set read-only session: ${String(error)}`);
      }
    });
    connection.query(`SET SESSION MAX_EXECUTION_TIME = ${QUERY_TIMEOUT_MS}`, (error: unknown) => {
      if (error) {
        console.error(`[mcp-mysql-ro] could not set statement timeout: ${String(error)}`);
      }
    });
  });

  pools.set(key, pool);
  await evictOldestPool();
  return pool;
}

export function resolveTarget(database?: string): ConnectionTarget {
  const active = requireActiveTarget();
  if (database) {
    return withDatabase(active, database);
  }
  return active;
}

export async function executeQuery(
  sql: string,
  params?: unknown[],
  database?: string
): Promise<unknown[]> {
  const pool = await getPool(resolveTarget(database));
  const [rows] = await pool.query(sql, params);
  return rows as unknown[];
}

/**
 * Open a connection to a candidate target and run a trivial query, so a switch
 * fails loudly at the moment it is requested instead of on the next read.
 */
export async function verifyTarget(target: ConnectionTarget): Promise<void> {
  const pool = await getPool(target);
  await pool.query("SELECT 1");
}

export async function closeAllPools(): Promise<void> {
  const open = Array.from(pools.values());
  pools.clear();
  await Promise.all(open.map((pool) => pool.end().catch(() => undefined)));
}
