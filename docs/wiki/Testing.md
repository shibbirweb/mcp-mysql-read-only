# Testing

Node's built-in `node:test` runner. No test framework dependency, and tests run against the compiled output in `dist/`, which is the artifact that actually ships.

## Layout

```
test/
  helpers/
    client.js      Minimal MCP client over stdio
    mysql.js       Fixture databases, connection details, skip probe
  unit/
    validation.test.js     Pure, no database
    connections.test.js    Pure, no database
  integration/
    server.test.js         Drives the real server against a real MySQL
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

## Unit tests

### `validation.test.js`

Organised in two halves, and **both matter equally**:

- Statements that must be rejected: bare writes, stacking hidden behind each comment style, writes behind a CTE, `EXPLAIN ANALYZE`, file patterns.
- Statements that must be allowed: a semicolon inside a literal, a comment marker inside a literal, a write keyword inside a literal or backticked identifier, and columns named `start`, `begin`, `create_at`.

The second half is the one that catches regressions. Making the validator stricter is easy and usually breaks ordinary queries; those cases pin the boundary. Any change to `validation.ts` needs a case on both sides.

### `connections.test.js`

`connections.ts` reads the environment once at import, so each case needs a fresh module instance:

```js
await import(`../../dist/connections.js?case=${counter++}`);
```

The query string makes the ESM loader treat the specifier as distinct and re-evaluate the module. The helper also saves and restores the relevant environment keys, and stubs `console.error` so the module's startup logging stays out of test output while remaining assertable.

Covered: defaults, malformed JSON, partial profiles, the single-connection fallback, starting-profile precedence, and two properties worth naming:

- **Copy-on-activate.** Mutating the active target must not edit the stored profile, or `use_database` would permanently rewrite a profile.
- **No password in `describeTarget`.** That function is the cache key *and* the display string, so a leak there reaches both logs and user output.

## Integration tests

`server.test.js` spawns the built server with `test/helpers/client.js` and exercises it over real stdio against real MySQL.

### The client is deliberately sequential

`McpClient` sends one request and waits for its response before sending the next.

Requests written in a batch are answered concurrently, and the active connection is shared process state, so a `use_database` batched next to a `run_query` is not ordered against it. Tests written that way fail intermittently and look like product bugs. This is the same caveat users hit, documented in [Architecture](Architecture).

Its `close()` sends `SIGTERM` rather than closing stdin, for the reason in [Server Lifecycle](Server-Lifecycle).

### Fixtures

`seed()` builds two databases, `mcp_test` and `mcp_test_alt`. Two are required: the entire point of the server is switching between them, which one database cannot exercise. They hold different tables on purpose, so a test can tell which database answered from the table list alone.

Seeding happens in a **file-level** `before`, not per suite. Both suites in the file share the fixtures, so per-suite teardown would pull the databases out from under whichever suite ran second. That was a real bug during development.

### Skipping

`probe()` attempts a connection at load time. If it fails, both suites are registered with `describe.skip` and the file reports why.

This keeps `npm test` usable for someone with no MySQL, but it creates a hazard: a broken CI service container would skip the integration half and still go green. CI therefore has an explicit step that runs the integration file, greps for the skip message and fails the build if it appears. A test suite that can silently test nothing is worse than one that fails.

### Coverage

The integration suite pins:

- The exact set of twelve tool names, so adding or renaming a tool is a deliberate change.
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
