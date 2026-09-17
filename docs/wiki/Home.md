# Developer documentation

Internal documentation for [mcp-mysql-read-only](https://github.com/shibbirweb/mcp-mysql-read-only). If you are here to *use* the server, the [README](https://github.com/shibbirweb/mcp-mysql-read-only#readme) is the place to start. These pages are for people changing the code.

Every page explains not just what a function does but why it is shaped that way, because most of the non-obvious decisions here exist to work around a specific failure that showed up in testing.

## Pages

| Page | Covers |
| --- | --- |
| [Architecture](Architecture) | Module map, request flow, the one piece of mutable state |
| [Configuration and Profiles](Configuration-and-Profiles) | `src/connections.ts`, where connections come from |
| [Connection Pooling](Connection-Pooling) | `src/db.ts`, pool cache, timeouts, the read-only session |
| [Read Only Enforcement](Read-Only-Enforcement) | `src/validation.ts`, the tokenizer and why it exists |
| [Tools](Tools) | `src/tools.ts`, every tool and its argument design |
| [Server Lifecycle](Server-Lifecycle) | `src/index.ts`, startup, shutdown, the stdin EOF trap |
| [Testing](Testing) | Suite layout, running without a local MySQL |
| [Release Process](Release-Process) | CI, Docker Hub publishing, wiki publishing |

## The one-paragraph summary

The server speaks MCP over stdio. A single mutable "active connection" lives in `connections.ts`. `db.ts` turns that connection into a pooled `mysql2` handle, caching one pool per distinct target so switching databases is instant and reversible. `tools.ts` exposes read tools and connection tools, all of which funnel their errors through one wrapper. `validation.ts` decides whether a statement is allowed to run at all. Nothing else holds state.

## Guiding principles

**Failures are tool errors, never crashes.** A bad query, a dead host, an unknown database: all come back as `isError: true` with a readable message. The process staying alive matters more than being strict, because a crashed MCP server takes the user's whole session with it.

**Never throw at import time.** A misconfigured environment produces a running server that explains the problem, not one that dies during handshake and looks like a broken install.

**Validate before interpolating.** Anything that reaches a backtick-quoted identifier is checked against a strict allowlist first. Values go through placeholders wherever the query shape permits.

**Assume the validator will eventually be wrong.** The MySQL session is configured read-only independently, so a hole in the parser is not automatically a write.
