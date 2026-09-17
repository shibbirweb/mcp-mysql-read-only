import { ConnectionRegistry } from "../connections/ConnectionRegistry.js";
import { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { ConnectionPoolManager } from "./ConnectionPoolManager.js";

/**
 * Runs queries against whichever connection is currently in scope.
 *
 * A thin Facade over the registry and the pool manager, so tools never have to
 * know how a target becomes a pool. It is also the single place a call decides
 * which connection it belongs to, which is why the per-call `database`
 * override costs one argument in each tool rather than a branch.
 */
export class QueryExecutor {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly pools: ConnectionPoolManager
  ) {}

  /**
   * No argument means the active connection; a database name means the active
   * connection pointed at that schema for this call only.
   *
   * @throws NoActiveConnectionError when nothing is configured yet.
   */
  public resolveTarget(database?: string): ConnectionTarget {
    const active = this.registry.requireActiveTarget();
    return database ? active.withDatabase(database) : active;
  }

  /**
   * Values go through placeholders wherever the query shape allows. MySQL
   * cannot parameterise identifiers, which is why callers validate every
   * identifier before interpolating it.
   *
   * Returns rows only; no caller needs mysql2's column metadata.
   */
  public async execute(sql: string, params?: unknown[], database?: string): Promise<unknown[]> {
    const pool = await this.pools.acquire(this.resolveTarget(database));
    const [rows] = await pool.query(sql, params);
    return rows as unknown[];
  }
}
