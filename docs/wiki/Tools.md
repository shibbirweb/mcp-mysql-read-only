# Tools

Source: `src/tools.ts`

Registers all twelve MCP tools. Every handler follows the same shape: validate arguments, do the work, return text.

## Shared helpers

### `text(body)` / `failure(body)` / `json(rows)`

Thin constructors for MCP content blocks. They exist so no handler hand-rolls the `{ content: [{ type: "text", text }] }` envelope, and so `isError` is set consistently.

`failure` prefixes `Error: `. The prefix matters: an assistant reading tool output decides what to do next from the text, and an unprefixed message is easily mistaken for data.

### `guard(run)`

Wraps every handler body in try/catch and converts a thrown error into a tool error.

This is the reason a dropped connection, a MySQL syntax error or an unconfigured server never takes the process down. An MCP server that exits kills the user's session; one that returns an error lets them try again.

It is also what lets `requireActiveTarget()` throw freely in `connections.ts`: the throw becomes a readable tool error carrying its own instructions. See [Configuration and Profiles](Configuration-and-Profiles).

There is an integration test that issues a deliberate syntax error and then a valid query, asserting the second still works.

### `checkDatabaseParam(database?)`

Validates the optional `database` argument, returning an error string or `null`.

Returning a string rather than throwing keeps the "argument was invalid" path distinct from the "something failed at runtime" path in `guard`. A bad argument is the caller's mistake and deserves a precise message.

Every tool that accepts `database` calls this first. Repetitive, but the alternative is a middleware layer over the MCP SDK's registration API that would obscure more than it saves.

### `formatRows(rows)`

Serialises rows, truncating at `MAX_OUTPUT_ROWS` (100) and appending a note naming the real count.

Truncation protects the context window: a `SELECT *` on a large table would otherwise flood the conversation and could exceed the client's message limit outright.

The note is deliberately actionable (`Add a LIMIT clause for smaller results`) and states the true total, so the reader knows they are seeing a sample and how to narrow it.

Note this truncates *output*, not the query. MySQL still materialises every row. `MAX_EXECUTION_TIME` is what bounds the cost of that.

## Connection tools

### `current_connection`

Reports the active profile and target. Reads `getActiveTarget()`, which returns `null` rather than throwing, so the unconfigured state is normal output instead of an error.

Renders through `describeTarget`, so the password cannot appear.

### `list_connections`

Lists profiles with `origin` and marks the active one with `*`.

Showing `(env)` versus `(session)` tells the reader which connections survive a restart. The `*` marker is easier to read at a glance than a separate "active:" line, and the integration test asserts exactly one line carries it.

### `list_databases`

`SHOW DATABASES` on the current server, hiding `information_schema`, `performance_schema`, `mysql` and `sys` unless `include_system` is true.

Those four are noise in most sessions and their presence makes it harder to spot the database you want. `include_system` exists because inspecting them is occasionally the actual task.

Also marks the active database with `*`, so "where am I and what else is here" is one call.

### `use_database`

Switches schema on the current server.

Order matters: validate the identifier, build the candidate with `withDatabase`, **verify it**, then commit. `verifyTarget` runs before `setActiveTarget`, so a nonexistent database fails the call and leaves the previous connection working.

It keeps the current profile name (`getActiveName() ?? "custom"`). The connection is still fundamentally "staging", just pointed at a different schema, and renaming it would lose that context.

### `use_connection`

Switches to a named profile, with an optional `database` override.

Membership is checked explicitly so the error can list the known profiles rather than relying on `setActiveProfile`'s generic throw. When someone mistypes a profile name, the list of real ones is the fastest fix.

The `database` override composes two ideas that would otherwise take two calls: "go to staging, but the analytics schema".

### `connect`

Opens an arbitrary server with explicit credentials.

This is the tool that makes a restart never necessary. `MYSQL_PROFILES` is a convenience; `connect` is the guarantee.

Defaults mirror `buildTarget`: `host` is `host.docker.internal`, `port` is 3306, `password` is empty. The host default is spelled out in the parameter description because it is the most common setup mistake, and a model reading that description will usually get it right unprompted.

`alias` is optional, defaulting to `custom`. Supplying one registers the connection so `use_connection` can return to it later. Without it, repeated ad-hoc connections just overwrite `custom`, which is the right behaviour for a one-off.

Credentials are never persisted. They live in the profile registry for the process lifetime and disappear on exit, which `list_connections` communicates through the `session` origin.

## Reading tools

All six accept an optional `database`.

### The per-call `database` argument

Every read tool takes it, and it applies to that call only.

It exists for two reasons. Comparing two databases otherwise means switching, reading, switching back, with the session left wherever the last call put it. And it is the correct answer to the parallel-call race described in [Architecture](Architecture): a call carrying its own `database` does not depend on shared mutable state and cannot be reordered against a switch.

Implementation is one line per tool, because `resolveTarget` in `db.ts` centralises the decision.

### `list_tables`

`SHOW TABLES`, unwrapped from MySQL's `Tables_in_<database>` column into a plain list with a count.

The raw result is a list of single-key objects whose key name varies by database, which is noisy to read and awkward to reference. A newline-separated list is far more useful as conversation context.

### `describe_table`

`SHOW COLUMNS FROM \`table\``.

The table name is interpolated because MySQL cannot parameterise identifiers, which is why `validateIdentifier` runs first. See [Read Only Enforcement](Read-Only-Enforcement).

`SHOW COLUMNS` rather than an `information_schema` query: shorter output, and it is already scoped to the pool's database.

### `get_table_indexes`

`SHOW INDEX FROM \`table\``. Same identifier handling.

### `get_foreign_keys`

Queries `information_schema.KEY_COLUMN_USAGE`, filtered to rows with a `REFERENCED_TABLE_NAME`.

The only read tool that uses a **parameterised** query, because here the table name is a value in a `WHERE` clause rather than an identifier. It is still validated first, since a rejected argument should fail the same way across all tools.

Scoped by `TABLE_SCHEMA = DATABASE()` so it reports the current database only. `DATABASE()` resolves to the pool's schema, which is correct under the per-call `database` override because that override selects a different pool.

Returns a plain sentence when there are no foreign keys, rather than `[]`. An empty array reads as "the query failed"; a sentence reads as an answer.

### `get_table_sample`

`SELECT * FROM \`table\` LIMIT n`.

The limit is interpolated, not parameterised, because MySQL will not accept a placeholder in `LIMIT` in all versions. It is safe because Zod constrains it to a number in 1..50 and the handler then re-clamps with `Math.min(Math.max(Math.trunc(limit), 1), 50)`.

The redundant clamp is deliberate. The schema constraint depends on the client validating arguments before dispatch; clamping in the handler means a value reaching this line cannot be anything but an integer in range, no matter how it got here.

### `run_query`

The general escape hatch. Validates with `validateReadOnlyQuery`, runs it, formats through `formatRows`.

No parameter binding is exposed. Adding a `params` argument would let an assistant separate values from SQL properly, but in practice models inline their values, and the validator plus the read-only session already bound what a query can do.

## Adding a tool

1. Register it in `registerTools` with a Zod schema.
2. Wrap the body in `guard`.
3. Validate identifiers with `validateIdentifier` before interpolating; use placeholders for values.
4. Accept `database: databaseParam` and pass it to `executeQuery` if it reads data.
5. Return through `text`, `json` or `failure`.
6. Add it to the expected tool list in `test/integration/server.test.js`, which asserts the exact set.

Write the description for a language model, not a person: it is the only thing telling the assistant when to reach for the tool. `use_database`'s description ends with "Takes effect immediately, no restart needed" precisely so an assistant does not tell the user to restart.
