# Architecture

## Modules

| File | Responsibility | Holds state? |
| --- | --- | --- |
| `src/index.ts` | Wire the MCP server to stdio, handle shutdown | No |
| `src/connections.ts` | Where connections come from, which one is active | **Yes**: the profile registry and the active target |
| `src/db.ts` | Turn a target into a pooled handle, run queries | **Yes**: the pool cache |
| `src/validation.ts` | Decide whether a statement may run | No, pure functions |
| `src/tools.ts` | Expose everything as MCP tools | No |

The dependency direction is one-way: `index` → `tools` → (`db`, `validation`) → `connections`. Nothing imports `tools`, and `validation` imports nothing at all, which is what makes it trivial to unit test.

## Request flow

A `run_query` call travels like this:

```
tools.ts    run_query handler
              |
              |  1. validate the database argument, if any
              v
validation  validateIdentifier   ->  reject early on a bad identifier
              |
              |  2. validate the SQL
              v
validation  validateReadOnlyQuery ->  reject early on anything that writes
              |
              |  3. run it
              v
db.ts       executeQuery
              |
              |  4. work out which target this call is for
              v
connections requireActiveTarget + withDatabase
              |
              |  5. find or create the pool for that target
              v
db.ts       getPool  ->  mysql2 pool, read-only session applied on connect
              |
              v
            rows -> truncated to 100 -> MCP text content
```

Validation always happens before anything touches the network. A rejected query costs no connection.

## The one piece of mutable state

Everything that makes this server different from a fixed-connection one comes down to two module-level variables in `connections.ts`:

```ts
let activeName: string | null = null;
let activeTarget: ConnectionTarget | null = null;
```

`activeTarget` is the full connection description. `activeName` is only a label for display. Every read tool resolves through `requireActiveTarget()`, so changing these two variables changes where every subsequent query goes.

That is the whole trick. There is no reconnect step and no teardown: `db.ts` keys its pool cache by the target's identity, so pointing at a different database simply selects a different pool, and pointing back reuses the original one.

### Why not issue `USE <database>`?

It would look simpler, but it makes the pool lie about itself. A `mysql2` pool opens several connections; `USE` only affects the one it was issued on. A later query served by a different connection from that pool would silently run against the old schema. Keying pools by database sidesteps the problem: every connection in a given pool was opened against the right schema from the start.

It also makes switching back free, since the previous pool is still warm in the cache.

### Consequence: parallel calls race

Because the active target is process-wide, two tool calls handled concurrently share it. An MCP client that batches calls can issue `use_database` and `run_query` together, and the query may be served before the switch lands.

This is deliberate rather than unnoticed. The alternative, a per-request connection scope, would mean the MCP protocol carrying a session identifier it does not have. The mitigation is the optional `database` argument on every read tool, which resolves the target for that one call and ignores the shared state entirely. See [Tools](Tools).

## Why no configuration file

An earlier design read profiles from a JSON file bind-mounted into the container. It was dropped for two reasons.

A bind mount is another thing that can be wrong: a missing host directory gets created as root-owned, a relative path resolves somewhere unexpected, and the failure surfaces as an empty profile list rather than an error. Environment variables are visible in the same place the image is configured.

More importantly, a file makes people think editing it is how you change connection. It is not. `connect` is, and it needs no file, no mount and no restart. `MYSQL_PROFILES` exists only as a convenience for connections you use constantly.

## Why stdio and not HTTP

MCP supports both. Stdio means the client owns the process lifetime, there is no port to bind, nothing to authenticate, and nothing is reachable from outside the machine. For a server holding database credentials, not listening on a socket is a feature.

The cost is that stdout is sacred: it carries the JSON-RPC stream, so a single stray `console.log` corrupts the protocol. Every diagnostic in this codebase goes to `console.error`.
