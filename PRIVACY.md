# Privacy Policy

Last updated: 22 September 2026

This policy covers `mcp-mysql-read-only`, distributed as the npm package `@shibbirweb/mcp-mysql-read-only` and the Docker image `shibbirweb/mcp-mysql-read-only`.

The short version: the server runs on your machine, talks to the MySQL server you point it at, and to nothing else. It collects nothing, sends nothing anywhere, and stores nothing after it exits.

## What the server sends, and where

One destination: the MySQL server named by your configuration, reached over your own network.

There is no telemetry, no analytics, no crash reporting, no update check, and no licence check. The author receives no data about you, your database, your queries or your usage, and has no way to. Its entire runtime dependency set is the MCP SDK, the MySQL driver and a validation library.

## What leaves your machine through the assistant

This is the part worth reading twice, because it is inherent to what an MCP server is.

When your AI assistant calls a tool, the result goes back to the assistant. If that assistant is a hosted model, **rows returned by a query are sent to the model provider along with the rest of your conversation**, under their privacy policy, not this one. Table names, column names, sample rows and query results are all conversation content once returned.

This server cannot prevent that, and neither can any other MCP server. What you can do:

- Connect with a MySQL account whose grants reach only the data you are willing to share. `SELECT` on the tables you need beats `SELECT` on everything.
- Treat tables holding personal data, credentials or payment details as off limits unless you specifically intend to expose them.
- Remember that `get_table_sample` returns real rows, not synthetic ones.

The read-only guarantee protects your data from being *changed*. It does not stop it from being *read*, which is the entire point of the tool.

## Tool descriptions

An MCP server tells your assistant what its tools do, and the assistant acts on that text. A server can abuse this by describing one thing and doing another, or by hiding instructions in a description to steer the model toward something you did not ask for. The descriptions here are not that.

Every tool's description states what the tool does and stops there. None of them contains instructions to the assistant about unrelated actions, hidden or invisible text, or any attempt to influence behaviour beyond choosing the right tool. `run_query` says it accepts `SELECT`, `WITH`, `SHOW`, `DESCRIBE` and `EXPLAIN` only, and that is exactly what the validator permits. `connect` says credentials are not persisted to disk, and nothing in this server writes to disk. `get_table_sample` says it returns sample rows, and they are real rows from your table, not synthetic ones.

The declared capability hints match the enforced behaviour. The nine reading tools declare `readOnlyHint: true` and cannot write: statements are rejected by the validator before any connection is used, and every pooled connection is additionally opened with `SET SESSION TRANSACTION READ ONLY`, so MySQL itself refuses a write that somehow got past. The three connection tools declare `readOnlyHint: false` because they change which server and database the session points at, and `destructiveHint: false` because they alter nothing in any database.

The tool list is fixed at build time. Nothing is fetched at runtime and no description can change after you install a version, so the tools you audit are the tools you run. CI asserts the annotations by reading them off a real handshake against the packaged artifact, which means a description or hint that drifted from behaviour fails before release.

## Credentials

Credentials reach the server in one of two ways: environment variables at startup, or the `connect` tool during a session.

They are held in memory for the life of the process and are never written to disk by this server. Connections are identified and displayed by a string built from user, host, port and database only, with the password deliberately excluded, so a password does not appear in log output or in tool results.

Two things outside this server's control are worth knowing:

- MCP client configuration files such as `claude_desktop_config.json` and `.mcp.json` store whatever you put in them in plain text on your disk. Keep them out of version control.
- Credentials passed to the `connect` tool travel through your assistant first, which makes them conversation content exactly as described above. Prefer environment variables or `MYSQL_PROFILES` for anything sensitive.

## Logs

Diagnostics go to standard error and consist of configuration warnings and the active connection description. No passwords, no query text, no result rows.

Standard error is captured by your MCP client, so where those lines end up is determined by that client.

## Retention

Nothing is persisted. The active connection, session profiles created with `connect`, and the connection pools all live in process memory and cease to exist when the process exits. The server keeps no database, cache, history or state file of its own.

## Third parties

At runtime, none.

Installing the software involves the distribution channel you chose, npm or Docker Hub, and those providers see the request under their own policies. The source is hosted on GitHub. None of these are contacted while the server is running.

## Changes

This policy is versioned in the repository, so its history is public. Material changes will accompany a release rather than arriving silently.

## Contact

Questions or corrections: https://github.com/shibbirweb/mcp-mysql-read-only/issues
