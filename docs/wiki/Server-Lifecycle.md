# Server Lifecycle

Source: `src/index.ts`

The smallest file in the project, and the one with the least obvious reasoning.

## Startup

```ts
const server = new McpServer({ name: "mysql-readonly-switchable", version: "1.0.0" });
registerTools(server);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP MySQL server running (read-only, switchable connection)");
```

Tools are registered before the transport connects, so the server can answer a `tools/list` arriving immediately after the handshake.

Importing `tools.ts` pulls in `connections.ts`, whose module-level code reads the environment and logs the active connection. So by the time the banner prints, the startup log already says which connection is active, or that none is.

The banner goes to **stderr**. On stdio transport stdout carries JSON-RPC, and one stray byte corrupts the stream. Every diagnostic in this codebase follows that rule.

### Nothing fatal at startup

There is no configuration check here and no exit path. A server with no usable connection still starts, still serves `tools/list`, and reports the problem through tool results.

An MCP client cannot show you a stderr message from a process that exited during handshake; it shows "server failed to start", which is indistinguishable from a broken image or a bad path. A running server that says `No active connection. Call connect...` is diagnosable, and often fixable in the same conversation.

## Shutdown

```ts
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await closeAllPools();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

The guard makes it idempotent. `SIGTERM` followed by `SIGINT`, or a repeated signal from an impatient supervisor, would otherwise run `closeAllPools` twice concurrently, the second time over a map already being torn down.

### Why the process cannot exit on its own

Once any query has run, the pool holds open sockets, and open handles keep the Node event loop alive. Without an explicit exit the process runs forever after its client has gone.

That makes it tempting to treat stdin closing as the shutdown signal. **That is a trap, and it was implemented and reverted.**

### The stdin EOF trap

Adding this looks obviously correct:

```ts
process.stdin.on("end", shutdown);   // do not do this
```

It breaks the server. `end` fires when stdin has no more *buffered* data, which is not the same as the client going away. A client that writes several requests and waits reaches EOF immediately, while its requests are still being processed. The pools are then torn down mid-flight and every subsequent call fails with `Pool is closed.`

This showed up the first time the server was driven by a script that piped its requests in one go: the first call succeeded and every later one failed. Under a real client, which holds stdin open, it would have appeared as an intermittent failure under load.

The correct signal is `SIGTERM`, which is what MCP clients send when they are genuinely finished. The comment in the source records this so it is not reintroduced.

The consequence for anything driving the server directly: read until you have the responses you expect, then terminate the process. `test/helpers/client.js` does exactly that in its `close()`.

## Container considerations

The image runs `node dist/index.js` as PID 1, so Node receives `SIGTERM` from `docker stop` directly and `shutdown` runs. There is no init shim, which is fine for a process that spawns no children.

Clients typically launch the server with `docker run -i --rm`. `-i` keeps stdin attached, which the stdio transport requires, and `--rm` means a crashed container leaves nothing behind.

Because the container lives for the whole session, everything held in memory (the active connection, session aliases from `connect`, the pool cache) persists across tool calls. That is precisely what makes runtime switching possible: state in a process that does not restart.
