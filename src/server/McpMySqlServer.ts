import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BaseTool } from "../tools/BaseTool.js";
import { ConnectionPoolManager } from "../database/ConnectionPoolManager.js";

/**
 * Owns the MCP server's lifetime.
 *
 * Takes tools as an already-constructed list rather than building them, so
 * this class knows nothing about MySQL or about which tools exist. Wiring is
 * the composition root's job; running is this one's.
 */
export class McpMySqlServer {
  private readonly server: McpServer;
  private shuttingDown = false;

  constructor(
    private readonly tools: BaseTool<never>[],
    private readonly pools: ConnectionPoolManager,
    private readonly logger: (message: string) => void,
    name = "mysql-readonly-switchable",
    version = "1.1.1"
  ) {
    this.server = new McpServer({ name, version });
  }

  public async start(): Promise<void> {
    // Registered before the transport connects, so a tools/list arriving
    // immediately after the handshake can be answered.
    for (const tool of this.tools) {
      tool.register(this.server);
    }

    this.installSignalHandlers();

    await this.server.connect(new StdioServerTransport());

    // stderr, always. On stdio transport stdout carries JSON-RPC and a single
    // stray byte corrupts the stream.
    this.logger("MCP MySQL server running (read-only, switchable connection)");
  }

  /**
   * Only signals, deliberately.
   *
   * Once a query has run the pool holds open sockets, and open handles keep
   * the Node event loop alive, so the process cannot exit on its own. That
   * makes it tempting to shut down when stdin closes. It is a trap, and it was
   * implemented and reverted: stdin `end` fires when no further requests are
   * *buffered*, not when the client has gone. A client that writes several
   * requests and waits reaches EOF while they are still being processed, so
   * the pools were torn down mid-flight and every later call failed with
   * "Pool is closed."
   *
   * SIGTERM is what a client sends when it is genuinely finished.
   */
  private installSignalHandlers(): void {
    const shutdown = () => {
      void this.shutdown();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  /** Idempotent, so a repeated signal cannot tear down pools twice at once. */
  public async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    await this.pools.closeAll();
    process.exit(0);
  }
}
