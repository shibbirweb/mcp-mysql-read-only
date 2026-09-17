# Developer documentation

Internal documentation for [mcp-mysql-read-only](https://github.com/shibbirweb/mcp-mysql-read-only). If you are here to *use* the server, the [README](https://github.com/shibbirweb/mcp-mysql-read-only#readme) is the place to start. These pages are for people changing the code.

Every page explains not just what a class does but why it is shaped that way, because most of the non-obvious decisions here exist to close a specific failure that showed up in testing.

## Pages

| Page | Covers |
| --- | --- |
| [Architecture](Architecture) | Layers, request flow, the one piece of mutable state |
| [Design Patterns](Design-Patterns) | Which patterns are used, where, and what each one bought |
| [Domain and Configuration](Domain-and-Configuration) | Value objects, the profile factory, the config loader, the registry |
| [Database Layer](Database-Layer) | Pool manager, session initializer, query executor |
| [Read Only Enforcement](Read-Only-Enforcement) | The skeletonizer, the rule chain, identifier validation |
| [Tools](Tools) | The tool class hierarchy and all twelve tools |
| [Server Lifecycle](Server-Lifecycle) | Composition root, startup, shutdown, the stdin EOF trap |
| [Testing](Testing) | Suite layout, running without a local MySQL |
| [Release Process](Release-Process) | CI, Docker Hub publishing, wiki publishing |

## The one-paragraph summary

The server speaks MCP over stdio. `ApplicationFactory` is the composition root: it reads configuration, builds every collaborator and hands a finished `McpMySqlServer` back. A `ConnectionRegistry` holds the profiles and the single active connection, and a `ConnectionManager` is the only thing allowed to change it. `ConnectionPoolManager` caches one `mysql2` pool per distinct connection, so switching databases selects a different pool rather than reconnecting. `ReadOnlyQueryValidator` walks a chain of rules to decide whether a statement may run at all. Each tool is its own class deriving from `BaseTool`.

## Layers

```
        index.ts  ->  ApplicationFactory  ->  McpMySqlServer
                              |
                 builds and injects everything below
                              |
   tools/  ->  connections/ + database/ + validation/ + formatting/
                              |
                          domain/  (value objects)
```

Dependencies point inward. `domain/` imports nothing of ours; `validation/` and `formatting/` import only types; `tools/` never constructs a collaborator.

## Guiding principles

**Everything is injected, nothing is a singleton.** No class reads `process.env` or constructs its own dependencies, so every one can be unit tested with a fake. The earlier version kept the registry and pool cache in module-level state, which tests could only reach by re-importing modules with a cache-busting query string.

**Failures are tool errors, never crashes.** A bad query, a dead host, an unknown database: all return `isError: true` with a readable message. `BaseTool` enforces this so no handler can forget it.

**Never throw at import time.** A misconfigured environment produces a running server that explains the problem, not one that dies during handshake and looks like a broken install.

**Validate before interpolating.** Anything reaching a backtick-quoted identifier is checked against a strict allowlist first. Values go through placeholders wherever the query shape permits.

**Assume the validator will eventually be wrong.** The MySQL session is configured read-only independently, so a hole in the parser is not automatically a write.
