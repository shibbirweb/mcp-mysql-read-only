# Configuration and Profiles

Source: `src/connections.ts`

This module answers two questions: what connections exist, and which one is active right now. It is the only place either is decided.

## Types

```ts
export interface ConnectionTarget {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}
```

Deliberately flat and fully resolved. Every field is present by the time a `ConnectionTarget` exists, so nothing downstream has to re-apply defaults or handle `undefined`. `db.ts` can hash it directly into a cache key because there is exactly one representation of a given connection.

```ts
export interface ConnectionProfile {
  name: string;
  origin: "env" | "session";
  target: ConnectionTarget;
}
```

`origin` exists purely for the human reading `list_connections`. An `env` profile was configured at startup and will come back after a restart; a `session` profile was opened with `connect` and will not. Surfacing that prevents the surprise of a connection that works all afternoon and vanishes the next day.

## Loading

### `buildTarget(raw, profileName)`

Turns one entry of the `MYSQL_PROFILES` JSON into a `ConnectionTarget`, applying defaults and rejecting incomplete entries.

`user` and `database` are required and throw when missing. Everything else has a default: `host` becomes `host.docker.internal`, `port` becomes `3306`, `password` becomes `""`.

The `host` default is the interesting one. The server almost always runs in a container while MySQL runs on the host, and in that arrangement `localhost` means the container itself, which is the single most common setup mistake with a containerised database client. Defaulting to `host.docker.internal` makes the common case work with no `host` key at all.

Each field is type-checked rather than trusted, because this is parsed JSON from an environment variable. `port` given as the string `"3306"` is rejected as a missing port and falls back to the default rather than producing `NaN` further down.

The error messages name the profile (`Profile "staging" is missing "user"`). With several profiles in one variable, an error that does not say which entry is broken is nearly useless.

### `loadEnvProfiles()`

Reads `MYSQL_PROFILES`, then the single-connection `MYSQL_*` fallback.

**Malformed JSON is logged and ignored, not thrown.** A typo in one environment variable should not stop the server from starting, because a running server can still be fixed with `connect`, while a dead one cannot be fixed at all: the client reports it as a failed connection with no explanation. The same reasoning applies per profile, so one broken entry is skipped while the rest load.

The single-connection fallback registers a profile named `default` only when both `MYSQL_USER` and `MYSQL_DATABASE` are set, since either alone cannot form a usable connection. It also refuses to overwrite a `default` already defined in `MYSQL_PROFILES`; explicit configuration wins over the fallback.

This fallback is what keeps the server a drop-in replacement for a conventional fixed-connection MySQL MCP server. Someone can point an existing `MYSQL_HOST`/`MYSQL_USER`/`MYSQL_DATABASE` config at this image and it works, then discover the switching later.

### `selectInitialProfile()`

Picks the starting connection, in order:

1. `MYSQL_DEFAULT_PROFILE`, if it names a real profile.
2. A profile named `default`.
3. The first profile defined.
4. Nothing.

Case 4 is not an error. The server starts with no active connection, `current_connection` says so, and read tools return a message pointing at `connect`. Refusing to start would be worse: an MCP client shows a server that exits during handshake as a broken installation, with no way to see why.

A `MYSQL_DEFAULT_PROFILE` naming a nonexistent profile logs a warning and falls through rather than failing. The name is usually a typo, and the useful response is to start anyway and say what happened.

## Module-level execution

```ts
loadEnvProfiles();
selectInitialProfile();
```

These run at import. It makes the module a singleton, which is what the design wants: one active connection per process.

The cost is testability, since the module reads `process.env` exactly once. The unit tests work around it by importing with a cache-busting query string (`import("../../dist/connections.js?case=1")`), which makes the ESM loader evaluate a fresh instance per case. See [Testing](Testing).

The startup banner also goes to `console.error`. On stdio, stdout is the protocol.

## Reading and mutating

### `listProfiles()` / `getProfile(profileName)`

Plain lookups over the registry. `listProfiles` returns insertion order, which is why "the first profile defined" is a meaningful fallback.

### `addSessionProfile(profileName, target)`

Registers a runtime connection under an alias, tagged `origin: "session"`. Called only by the `connect` tool. Registering rather than merely activating is what lets someone flip between an ad-hoc connection and a configured one with `use_connection`.

An existing name is overwritten. Reconnecting with corrected credentials under the same alias should replace the broken entry, not fail.

### `getActiveTarget()` / `getActiveName()` / `requireActiveTarget()`

Two readers and one asserting reader.

`requireActiveTarget()` throws a message naming both ways to fix the problem (`Call connect with host/user/database, or use_connection with a profile name`). It is called from inside tool handlers, all of which are wrapped in `guard()`, so the throw becomes a tool error carrying that text straight to the user. The error message *is* the user-facing documentation for the unconfigured state.

`getActiveTarget()` returns `null` instead of throwing so that `current_connection` can report the unconfigured state as normal output rather than as an error.

### `setActiveProfile(profileName)` / `setActiveTarget(target, profileName)`

Two ways to move the active connection: by profile name, or by explicit target plus a label.

Both copy: `activeTarget = { ...profile.target }`. Without the copy, a later mutation of the active target would edit the stored profile in place, so `use_database` would permanently rewrite the profile's database and `use_connection` could never return to the original. There is a unit test pinning exactly this.

`setActiveProfile` throws on an unknown name. The `use_connection` tool checks membership first so it can produce a better message listing the known profiles, which makes the throw here a backstop rather than the normal path.

### `withDatabase(target, database)`

Returns a copy with a different database. Pure, and the reason switching schema is cheap: no reconnection logic, just a new key into the pool cache.

Used for `use_database`, the `database` override on `use_connection`, and the per-call `database` argument on every read tool.

### `describeTarget(target)`

Renders `user@host:port/database`.

**It never includes the password**, which is why every user-facing message about a connection goes through this function rather than formatting a target inline. It is also the pool cache key in `db.ts`, so the identity of a connection and its display form are the same string by construction, and cannot drift apart. There is a unit test asserting a password cannot leak through it.

## Adding a field to a connection

If a connection ever needs, say, TLS options:

1. Add it to `ConnectionTarget`.
2. Default it in `buildTarget`, and in the single-connection fallback in `loadEnvProfiles`.
3. Decide whether it belongs in `describeTarget`. **If it distinguishes two otherwise identical connections, it must be included**, or two different connections will collide on one cache key in `db.ts` and the second will silently reuse the first one's pool.
4. Pass it through in `db.ts`'s `createPool` call.
5. Add it to the `connect` tool's schema in `tools.ts`.
