# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Where a version reached one distribution channel but not another, the entry says so.

## [1.1.6] - Unreleased

### Added

- A human-readable title on every tool (for example "Run Read-Only Query" for `run_query`), sent both as the tool's `title` and as `annotations.title`, so clients show a label instead of the snake_case name.
- CI asserts that every tool carries a title, alongside the existing check for all four hints.

### Changed

- Each tool now states its own four capability hints in its own class instead of nine of them inheriting a default from `BaseTool`. The values sent to clients are unchanged. The inherited default was correct on the wire but invisible in each tool's source, which is what source-reading directory scanners check, so they reported every hint as missing. A missing hint or title is now a compile error.

## [1.1.5] - Unreleased

### Added

- All four MCP capability hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are now declared explicitly on every one of the twelve tools. The reading tools previously declared only the two the specification treats as meaningful, which left a client or an auditor unable to tell "not destructive" from "not stated".
- `PRIVACY.md`, covering what the server sends and where, what reaches your assistant's model provider through tool results, credential handling, logging, retention and tool description accuracy. Linked from both READMEs.
- CI asserts that every tool declares all four hints, read off a real handshake against the packaged tarball.

## [1.1.4] - 2026-09-22

### Added

- Listed on the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.shibbirweb/mcp-mysql-read-only`. `server.json` declares both the npm package and the Docker image, so a client installs whichever it supports.
- `io.modelcontextprotocol.server.name` annotation on the image, which is how the registry verifies the OCI package belongs to this repository.
- Registry publishing is automated on release, authenticated over OIDC with no stored secret. It waits for the npm version and the image tag to be live first, because ownership is verified against published artifacts.
- CI asserts that `server.json` and `package.json` still name the same package, since a rename is only rejected at publish time, after the npm version has become immutable.

### Fixed

- The release documentation described the Docker Hub description as syncing `README.md` from the publish workflow. It is `README.dockerhub.md`, synced by its own workflow.

## [1.1.3] - 2026-09-22

### Changed

- npm publishing now runs over OIDC trusted publishing only. The token path is gone, along with the possibility of a stale or re-added `NPM_TOKEN` secret quietly taking precedence over it. Released versions carry a provenance attestation from here on.
- Releases are bumped with `npm version patch --no-git-tag-version` and tagged by the GitHub release on the merge commit. Plain `npm version` tagged the branch commit, pointing the release at a tree `master` never had.

## [1.1.2] - 2026-09-22

### Changed

- **The package is now `@shibbirweb/mcp-mysql-read-only`.** npm refuses the unscoped `mcp-mysql-read-only` as too similar to `mcp-mysql-readonly`, an existing package by another author. Install with `npx -y @shibbirweb/mcp-mysql-read-only`. The command remains `mcp-mysql-read-only`, because bin names are not scoped.
- The README no longer claims the server runs entirely in Docker, which stopped being true when the npm path was added.

### Notes

- First version published to npm, and the earliest version available there.

## [1.1.1] - 2026-09-22

### Added

- npm distribution alongside Docker: `bin`, an executable entry point, and a `prepack` build, so the server can run with `npx` and no container. Over npm there is no network namespace between the server and the database, so `127.0.0.1` means the host you are on.
- Both install paths documented in the README, including the trade: the container is the more isolated of the two, and npm runs with your user's access.
- CI packs the tarball, installs it into a clean project, and drives the installed binary over MCP stdio, so a broken `bin`, a missing `files` entry or a lost shebang fails before release.

### Changed

- The version reported in the MCP handshake is read from `package.json` instead of a literal in the server class, so it cannot drift from the released version. `scripts/sync-version.mjs` propagates the version to the two files that cannot read it, and CI fails when they disagree.

### Notes

- Published to Docker Hub only. The npm publish was rejected over the package name, which 1.1.2 resolved.

## [1.1.0] - 2026-09-22

### Added

- MCP tool annotations on all twelve tools. The nine reading tools declare `readOnlyHint: true`, so a client can run them without stopping to ask; `connect`, `use_database` and `use_connection` declare `readOnlyHint: false` with `destructiveHint: false`, because they repoint the session without touching data.

### Changed

- Tool registration moved from the deprecated positional `server.tool` to `server.registerTool`, which is what carries the annotations.
- Dependencies updated: `@modelcontextprotocol/sdk` 1.12.3 to 1.30.0, `mysql2` 3.14.5 to 3.24.4, `zod` 3.23 to 3.25, clearing four high-severity advisories.

### Fixed

- A typings mismatch surfaced by the `mysql2` update, where the pool's `connection` event is declared as handing over the promise-API connection while the callback-API one actually arrives. Corrected at the event boundary, with no runtime change: the read-only session backstop applies exactly as before.

## [1.0.0] - 2026-09-17

Initial release, distributed as a Docker image for `linux/amd64` and `linux/arm64`.

### Added

- Twelve tools over MCP stdio: `run_query`, `list_tables`, `describe_table`, `get_table_indexes`, `get_foreign_keys`, `get_table_sample`, `list_databases`, `list_connections`, `current_connection`, `connect`, `use_connection`, `use_database`.
- Runtime-switchable connections. The active database, server and credentials can change mid-conversation without restarting the client, because the connection is process state rather than startup configuration.
- Read-only enforcement in two independent layers: a validator that rejects anything but `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `DESC` and `EXPLAIN` before any connection is used, and `SET SESSION TRANSACTION READ ONLY` on every pooled connection so MySQL itself refuses a write that somehow got past. A parser bug alone is not enough to become a write.
- Named connections through `MYSQL_PROFILES`, with a per-call `database` override on every reading tool so comparing two schemas does not require switching and switching back.
- One connection pool per target, cached by connection identity, so switching selects a different pool rather than reconnecting and switching back reuses a warm one.

[1.1.6]: https://github.com/shibbirweb/mcp-mysql-read-only/compare/v1.1.5...HEAD
[1.1.5]: https://github.com/shibbirweb/mcp-mysql-read-only/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/shibbirweb/mcp-mysql-read-only/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/shibbirweb/mcp-mysql-read-only/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/shibbirweb/mcp-mysql-read-only/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/shibbirweb/mcp-mysql-read-only/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/shibbirweb/mcp-mysql-read-only/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/shibbirweb/mcp-mysql-read-only/releases/tag/v1.0.0
