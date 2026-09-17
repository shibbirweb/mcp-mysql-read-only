import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { closeAllPools } from "./db.js";

const server = new McpServer({
  name: "mysql-readonly-switchable",
  version: "1.0.0",
});

registerTools(server);

let shuttingDown = false;

// Open pool sockets keep the event loop alive, so the process never exits on
// its own once a connection has been made. The client closing the pipe is not
// a shutdown signal: stdin reaching EOF only means no further requests were
// buffered, and acting on it would tear down pools while calls are in flight.
// The client sends SIGTERM when it is genuinely done.
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

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("MCP MySQL server running (read-only, switchable connection)");
