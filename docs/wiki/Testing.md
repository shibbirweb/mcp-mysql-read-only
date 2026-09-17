# Testing

Node's built-in `node:test` runner. No test framework dependency, and tests run against the compiled output in `dist/`, which is the artifact that actually ships.

## Layout

The unit tree mirrors `src/`:

```
test/
  helpers/
    client.js                          Minimal MCP client over stdio
    mysql.js                           Fixture databases, skip probe
  unit/
    config/EnvironmentConfigLoader.test.js
    connections/ConnectionRegistry.test.js
    connections/ConnectionManager.test.js
    domain/ConnectionTarget.test.js
    formatting/RowFormatter.test.js
    validation/ReadOnlyQueryValidator.test.js
    validation/SqlSkeletonizer.test.js
    validation/IdentifierValidator.test.js
  integration/
    server.test.js                     Real server, real MySQL, over stdio
```

## Running

Without installing anything on your machine:

```bash
./scripts/test-in-docker.sh
```

Starts a throwaway MySQL container, builds the test image, runs everything against it and cleans up. Your own MySQL is never touched.

With Node 22 locally:

```bash
npm ci
npm run test:unit          # no database needed
npm test                   # everything
```

Note `npm test` runs `node --test` with **no path argument**. Passing a directory (`node --test test/`) fails with `Cannot find module` on some Node 22 patch releases; the runner's own discovery is reliable.

Integration tests read `TEST_MYSQL_HOST`, `TEST_MYSQL_PORT`, `TEST_MYSQL_USER` and `TEST_MYSQL_PASSWORD`.

## What dependency injection bought

Constructor injection is the reason most of the unit suite can exist at all.

**Configuration.** `EnvironmentConfigLoader` takes the environment as an argument, so a case is an object literal. The earlier procedural version read `process.env` at module scope, which forced tests to re-import modules with a `?case=N` query string to defeat the ESM cache, and to stub `console.error` to capture warnings. Both hacks are gone: warnings are returned as data.

**Connection switching.** `ConnectionManager` takes the pool manager, so `ConnectionManager.test.js` supplies a `FakePoolManager` and asserts the verify-then-commit rule with no database: that a failed switch leaves the previous connection active, that an unknown profile never reaches the network, and that a failed `connect` registers nothing. None of that was unit testable before.

**Validation.** Rules are injected into `ReadOnlyQueryValidator`, so tests can assemble a two-rule chain and assert on ordering, or an empty chain proving rules are the only gate.

## Unit tests

### Validation

`ReadOnlyQueryValidator.test.js` is organised in halves, and **both matter equally**:

- Statements that must be rejected: bare writes, stacking behind each comment style, writes behind a CTE, `EXPLAIN ANALYZE`, file patterns.
- Statements that must be allowed: a semicolon inside a literal, a comment marker inside a literal, a write keyword inside a literal or backticked identifier, and columns named `start`, `begin`, `create_at`.

The second half catches regressions. Making the validator stricter is easy and usually breaks ordinary queries; those cases pin the boundary. Any change to a rule needs a case on both sides.

`SqlSkeletonizer.test.js` covers the tokenizer directly, including unterminated literals and the MySQL rule that `--` needs trailing whitespace to start a comment.

### Domain

`ConnectionTarget.test.js` pins two properties that matter beyond the class:

- **The password never appears in `key()`**, which is both the cache key and the display string, so a leak there would reach logs and user output.
- **Immutability.** Reassigning a field throws, and `withDatabase` leaves the original untouched. This is the property whose absence made the procedural version fragile.

## Integration tests

`server.test.js` spawns the built server with `test/helpers/client.js` and exercises it over real stdio against real MySQL.

It was **not changed by the OOP refactor**, which is what makes it the regression check: the same suite passing before and after is evidence the rewrite preserved behaviour rather than merely compiling.

### The client is deliberately sequential

`McpClient` sends one request and waits for its response before sending the next.

Requests written in a batch are answered concurrently, and the active connection is shared process state, so a `use_database` batched next to a `run_query` is not ordered against it. Tests written that way fail intermittently and look like product bugs. This is the same caveat users hit, documented in [Architecture](Architecture).

Its `close()` sends `SIGTERM` rather than closing stdin, for the reason in [Server Lifecycle](Server-Lifecycle).

### Fixtures

`seed()` builds two databases, `mcp_test` and `mcp_test_alt`. Two are required: the entire point of the server is switching between them, which one database cannot exercise. They hold different tables on purpose, so a test can tell which database answered from the table list alone.

Seeding happens in a **file-level** `before`, not per suite. Both suites share the fixtures, so per-suite teardown would pull the databases out from under whichever ran second. That was a real bug during development.

### Skipping

`probe()` attempts a connection at load time. If it fails, both suites are registered with `describe.skip` and the file reports why.

This keeps `npm test` usable for someone with no MySQL, but creates a hazard: a broken CI service container would skip the integration half and still go green. CI therefore runs the integration file separately, greps for the skip message and fails the build if it appears. A suite that can silently test nothing is worse than one that fails.

### Coverage

- The exact set of twelve tool names, so adding or renaming one is deliberate.
- Every read tool against known fixture data.
- Each switching mechanism, verified with `SELECT DATABASE()` rather than the tool's own success message.
- The per-call `database` override leaving the active connection unchanged.
- Writes rejected, then a count proving the data is genuinely untouched.
- `@@session.transaction_read_only` and `@@session.max_execution_time`, so the server-side backstop cannot quietly stop being applied.
- Identifier injection attempts.
- Failure paths leaving the session usable: unknown database, unknown profile, syntax error.
- Truncation at 100 rows.
- A server started with no configuration at all, ending with `connect` bringing it to life.

## CI

`.github/workflows/ci.yml` runs on pull requests to `master` and pushes to `master`.

- **test**: matrix over MySQL 8.0 and 8.4, with typecheck, build and the full suite, plus the did-integration-actually-run assertion.
- **docker**: builds the release image for amd64 and arm64 without pushing, runs unit tests inside the test image, and smoke-tests the MCP handshake end to end.

The arm64 build runs on PRs because a Dockerfile change that only breaks arm64 would otherwise surface at release time, when it is most expensive.
