# Connection Pooling

Source: `src/db.ts`

Turns a `ConnectionTarget` into a live `mysql2` pool and runs queries against it. Everything here exists to make switching connections cheap and to make each connection read-only at the server.

## The pool cache

```ts
const pools = new Map<string, mysql.Pool>();
```

Keyed by `describeTarget(target)`, so `reader@db:3306/app` and `reader@db:3306/analytics` are separate pools. Switching database selects a different entry; switching back reuses a warm one.

Deriving the key from `describeTarget` rather than writing a second serialiser means identity and display can never disagree. It also means adding a field to `ConnectionTarget` without adding it to `describeTarget` silently makes two distinct connections collide, which is called out in [Configuration and Profiles](Configuration-and-Profiles).

### `targetKey(target)`

A one-line wrapper over `describeTarget`. It exists so the intent is greppable: this call is computing a cache key, not formatting output. If the two ever need to diverge, this is the single place to change.

### `getPool(target)`

Find or create the pool for a target.

**Cache hit** deletes and re-inserts the entry:

```ts
pools.delete(key);
pools.set(key, existing);
```

A JavaScript `Map` iterates in insertion order, so re-inserting moves the entry to the back and leaves the least recently used at the front. That gives an LRU with no bookkeeping beyond two Map operations, and `evictOldestPool` can just take the first key.

**Cache miss** creates a pool. The options that matter:

| Option | Value | Why |
| --- | --- | --- |
| `connectionLimit` | 3 | One assistant asking questions is not a web app. Three allows a little overlap while keeping the footprint small across several cached pools. |
| `multipleStatements` | **false** | The single most important line in the file. See below. |
| `waitForConnections` | true | Queue rather than error when all three are busy. |
| `connectTimeout` | `MYSQL_CONNECT_TIMEOUT_MS`, default 10s | An unreachable host must fail in seconds, not hang the session. |
| `dateStrings` | true | Dates come back as the strings MySQL stored. `Date` objects would be serialised through `JSON.stringify` into UTC ISO strings, silently shifting every timestamp by the server's offset. |

#### Why `multipleStatements: false` matters so much

With it enabled, `query("SELECT 1; DROP TABLE users")` runs both statements. The entire read-only guarantee would then rest on the validator correctly finding every statement separator, including ones inside string literals and comments.

Turning it off moves that guarantee into the driver. Even a validator bug cannot produce a second statement, because the protocol will not carry one. The validator's own stacking check becomes a better error message rather than the only thing standing between a user and a dropped table.

The cost is that `run_query` cannot return multiple result sets. That is an acceptable trade for a read-only server.

### The session initialiser

```ts
pool.on("connection", (connection) => {
  connection.query("SET SESSION TRANSACTION READ ONLY", ...);
  connection.query(`SET SESSION MAX_EXECUTION_TIME = ${QUERY_TIMEOUT_MS}`, ...);
});
```

The `connection` event fires once per physical connection a pool opens, which is exactly the right hook: applied once per connection rather than once per query, and automatically applied to connections opened later as the pool grows.

**`SET SESSION TRANSACTION READ ONLY`** sets the default access mode for subsequent transactions in that session. With autocommit on, every statement is its own transaction, so any write is rejected by MySQL with error 1792 (`Cannot execute statement in a READ ONLY transaction`). This is the independent second layer: a hole in the validator is not automatically a write.

It cannot be turned off from a query, because `SET` is not an allowed leading keyword and statement stacking is impossible.

**`SET SESSION MAX_EXECUTION_TIME`** caps `SELECT` execution server-side. A runaway query on a large table is killed by MySQL instead of hanging the conversation. It applies only to read-only `SELECT`s, which is all this server runs.

Both use callback style and log failures to stderr rather than rejecting. A pool `connection` event handler has nowhere to propagate a rejection to, so an unhandled one would take the process down. A connection that could not be set read-only is still usable and still validator-guarded, so logging and continuing is correct; the alternative is a crash on a MySQL variant that does not support one of these variables.

There is an integration test asserting `@@session.transaction_read_only` is `1`, so this cannot silently stop working.

### `evictOldestPool()`

Caps the cache at `MAX_POOLS` (8) and closes the pool it drops.

Without a cap, a session that touches many databases accumulates a pool per database, each holding up to three open connections. Eight is comfortably more than anyone flips between in one conversation while bounding the connection count at 24.

It runs after insertion, so the cap is briefly exceeded and then corrected. Evicting first would risk dropping the pool that is about to be used.

`pool.end()` is swallowed with `.catch(() => undefined)`. A pool being discarded may already be broken; failing to close a pool nobody will use again is not worth surfacing.

## Running queries

### `resolveTarget(database?)`

The single place a call decides which connection it is for. No argument means the active target; a `database` argument means the active target with that schema swapped in.

Centralising this is why the per-call `database` override is one line in each tool rather than a branch in each one.

### `executeQuery(sql, params?, database?)`

Resolve the target, get the pool, run the query, return the rows.

Parameters are passed through to `pool.query`, so anything that can be a placeholder is one. Identifiers cannot be parameterised in MySQL, which is why `tools.ts` validates every identifier against a strict allowlist before interpolating it. See [Read Only Enforcement](Read-Only-Enforcement).

It returns only `rows`, discarding the `fields` half of the `mysql2` tuple. No caller needs column metadata; `describe_table` asks MySQL for it explicitly.

### `verifyTarget(target)`

Opens the pool for a target and runs `SELECT 1`.

This is what makes a failed switch fail at the point of switching. Without it, `use_database` against a nonexistent database would report success, and the error would appear on some later unrelated query, looking like a problem with that query instead.

It runs *before* the active target is updated, so a failed switch leaves the previous connection intact and the session usable. There are integration tests for both halves: the switch errors, and the old connection still works afterwards.

It also warms the pool, so the first real query after a switch does not pay connection setup.

### `closeAllPools()`

Closes every pool and clears the cache, called from the shutdown path in `index.ts`.

It clears the map *before* awaiting, so a query arriving mid-shutdown creates a fresh pool rather than using one being torn down. Individual failures are swallowed and all closes run concurrently through `Promise.all`, because shutdown should not stall on one unreachable server.

Note that closing pools is what lets the process exit at all: open sockets keep the Node event loop alive. This has a direct consequence for shutdown handling, covered in [Server Lifecycle](Server-Lifecycle).

## Timeouts

| Variable | Default | Effect |
| --- | --- | --- |
| `MYSQL_CONNECT_TIMEOUT_MS` | 10000 | How long a new connection may take before failing |
| `MYSQL_QUERY_TIMEOUT_MS` | 30000 | `MAX_EXECUTION_TIME` for `SELECT`s on every connection |

Both are read once at module load. Changing them needs a restart, unlike connection details; they are operational tuning rather than something to adjust mid-conversation.
