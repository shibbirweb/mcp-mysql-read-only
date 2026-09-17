import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { SessionInitializer } from "./SessionInitializer.js";
import type { PoolTuning } from "../types/connection.types.js";

/**
 * An Object Pool registry: one mysql2 pool per distinct connection, with LRU
 * eviction.
 *
 * This is what makes switching cheap. Changing database selects a different
 * pool rather than reconnecting, and switching back reuses a warm one.
 *
 * Pools are keyed by ConnectionTarget.key() rather than by issuing `USE`. A
 * pool holds several connections and `USE` affects only the one it ran on, so a
 * later query served by a different connection would silently run against the
 * old schema. Every connection in a given pool is opened against the right
 * schema from the start.
 */
export class ConnectionPoolManager {
  private readonly pools = new Map<string, Pool>();

  constructor(
    private readonly tuning: PoolTuning,
    private readonly sessionInitializer: SessionInitializer
  ) {}

  public async acquire(target: ConnectionTarget): Promise<Pool> {
    const key = target.key();
    const existing = this.pools.get(key);

    if (existing) {
      this.touch(key, existing);
      return existing;
    }

    const pool = this.createPool(target);
    this.pools.set(key, pool);
    await this.evictOverflow();
    return pool;
  }

  /**
   * Open the connection and run a trivial query.
   *
   * Called before committing a switch so a bad database or unreachable host
   * fails at the moment it is requested, rather than surfacing later on an
   * unrelated query. It also warms the pool, so the first real query after a
   * switch does not pay connection setup.
   */
  public async verify(target: ConnectionTarget): Promise<void> {
    const pool = await this.acquire(target);
    await pool.query("SELECT 1");
  }

  /**
   * Closing pools is what allows the process to exit: open sockets keep the
   * Node event loop alive.
   *
   * The map is cleared before awaiting, so a query arriving mid-shutdown
   * creates a fresh pool rather than using one being torn down. Failures are
   * swallowed and closes run concurrently, because shutdown must not stall on
   * one unreachable server.
   */
  public async closeAll(): Promise<void> {
    const open = Array.from(this.pools.values());
    this.pools.clear();
    await Promise.all(open.map((pool) => pool.end().catch(() => undefined)));
  }

  public get size(): number {
    return this.pools.size;
  }

  private createPool(target: ConnectionTarget): Pool {
    const pool = mysql.createPool({
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      database: target.database,
      connectionLimit: this.tuning.connectionLimit,
      waitForConnections: true,

      // The single most important option here. With multiple statements
      // enabled, the read-only guarantee would rest entirely on the validator
      // finding every separator, including ones inside literals. Disabled, the
      // protocol cannot carry a second statement at all, so a validator bug is
      // not a dropped table.
      multipleStatements: false,

      connectTimeout: this.tuning.connectTimeoutMs,

      // Without this, mysql2 returns Date objects that JSON.stringify converts
      // to UTC ISO strings, silently shifting every timestamp by the server's
      // offset. Strings come back exactly as MySQL stored them.
      dateStrings: true,
    });

    this.sessionInitializer.attachTo(pool);
    return pool;
  }

  /**
   * A Map iterates in insertion order, so deleting and re-inserting moves an
   * entry to the back and leaves the least recently used at the front. That is
   * a complete LRU for two Map operations and no extra bookkeeping.
   */
  private touch(key: string, pool: Pool): void {
    this.pools.delete(key);
    this.pools.set(key, pool);
  }

  /**
   * Runs after insertion, so the cap is briefly exceeded then corrected.
   * Evicting first would risk dropping the pool that is about to be used.
   */
  private async evictOverflow(): Promise<void> {
    while (this.pools.size > this.tuning.maxPools) {
      const oldest = this.pools.keys().next();
      if (oldest.done) {
        return;
      }
      const pool = this.pools.get(oldest.value);
      this.pools.delete(oldest.value);
      if (pool) {
        await pool.end().catch(() => undefined);
      }
    }
  }
}
