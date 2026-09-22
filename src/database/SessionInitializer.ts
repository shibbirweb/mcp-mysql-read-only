import type { Pool } from "mysql2/promise";

/**
 * The connection this module actually deals with: the callback-API one.
 *
 * mysql2's promise typings declare the pool's `connection` event as handing
 * over the promise-API `PoolConnection`, but `PromisePool` re-emits the core
 * pool's event with its arguments untouched, so what arrives is the core
 * connection, whose `query` takes a callback. The event is the only place the
 * two APIs meet, so the correction is applied there and nowhere else.
 */
type CoreConnection = {
  query: (sql: string, callback: (error: unknown) => void) => void;
};

/**
 * Applies the server-side half of the read-only guarantee to every connection
 * a pool opens.
 *
 * Separated from the pool manager because it is the security-critical part and
 * deserves to be findable on its own. The pool manager decides *when*
 * connections exist; this decides *what they are allowed to do*.
 *
 * This is the layer that holds if the SQL validator is ever wrong. The two are
 * independent by design: a parser bug should not automatically be a write.
 */
export class SessionInitializer {
  constructor(
    private readonly queryTimeoutMs: number,
    private readonly logger: (message: string) => void
  ) {}

  /**
   * Hooks the pool's `connection` event, which fires once per physical
   * connection. Once per connection rather than once per query, and it also
   * covers connections opened later as the pool grows.
   */
  public attachTo(pool: Pool): void {
    pool.on("connection", (connection) => {
      const coreConnection = connection as unknown as CoreConnection;

      // SET SESSION TRANSACTION READ ONLY sets the access mode for subsequent
      // transactions. With autocommit on, every statement is its own
      // transaction, so MySQL rejects any write with error 1792. It cannot be
      // undone from a query: SET is not an allowed leading keyword, and
      // statement stacking is impossible with multipleStatements disabled.
      this.apply(coreConnection, "SET SESSION TRANSACTION READ ONLY", "set read-only session");

      // Caps SELECT execution server-side so a runaway query is killed by
      // MySQL instead of hanging the conversation.
      this.apply(
        coreConnection,
        `SET SESSION MAX_EXECUTION_TIME = ${this.queryTimeoutMs}`,
        "set statement timeout"
      );
    });
  }

  /**
   * Failures are logged, never thrown.
   *
   * A pool `connection` event handler has nowhere to propagate a rejection to,
   * so an unhandled one would take the process down. A connection that could
   * not be set read-only is still guarded by the validator, so continuing is
   * correct; crashing on a MySQL variant lacking one of these variables is not.
   */
  private apply(connection: CoreConnection, sql: string, description: string): void {
    connection.query(sql, (error: unknown) => {
      if (error) {
        this.logger(`could not ${description}: ${String(error)}`);
      }
    });
  }
}
