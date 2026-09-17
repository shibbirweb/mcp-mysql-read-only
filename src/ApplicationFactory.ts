import { EnvironmentConfigLoader } from "./config/EnvironmentConfigLoader.js";
import { ConnectionManager } from "./connections/ConnectionManager.js";
import { ConnectionRegistry } from "./connections/ConnectionRegistry.js";
import { ConnectionTargetFactory } from "./connections/ConnectionTargetFactory.js";
import { ConnectionPoolManager } from "./database/ConnectionPoolManager.js";
import { QueryExecutor } from "./database/QueryExecutor.js";
import { SessionInitializer } from "./database/SessionInitializer.js";
import { RowFormatter } from "./formatting/RowFormatter.js";
import { McpMySqlServer } from "./server/McpMySqlServer.js";
import { BaseTool } from "./tools/BaseTool.js";
import { ConnectTool } from "./tools/connection/ConnectTool.js";
import { CurrentConnectionTool } from "./tools/connection/CurrentConnectionTool.js";
import { ListConnectionsTool } from "./tools/connection/ListConnectionsTool.js";
import { ListDatabasesTool } from "./tools/connection/ListDatabasesTool.js";
import { UseConnectionTool } from "./tools/connection/UseConnectionTool.js";
import { UseDatabaseTool } from "./tools/connection/UseDatabaseTool.js";
import { DescribeTableTool } from "./tools/reading/DescribeTableTool.js";
import { GetForeignKeysTool } from "./tools/reading/GetForeignKeysTool.js";
import { GetTableIndexesTool } from "./tools/reading/GetTableIndexesTool.js";
import { GetTableSampleTool } from "./tools/reading/GetTableSampleTool.js";
import { ListTablesTool } from "./tools/reading/ListTablesTool.js";
import { RunQueryTool } from "./tools/reading/RunQueryTool.js";
import { IdentifierValidator } from "./validation/IdentifierValidator.js";
import { ReadOnlyQueryValidator } from "./validation/ReadOnlyQueryValidator.js";
import type { ConfigurationLoader } from "./types/config.types.js";

/**
 * The composition root: the one place that knows how every part fits together.
 *
 * Every other class takes its collaborators through its constructor and
 * constructs none of them, which is why they can be unit tested without the
 * environment, without a database, and without module-level singletons. All of
 * that wiring has to happen somewhere, and concentrating it here keeps it out
 * of the classes themselves.
 */
export class ApplicationFactory {
  /** Not per-target: a handful of connections is ample for one assistant. */
  private static readonly POOL_CONNECTION_LIMIT = 3;

  /**
   * More databases than anyone flips between in a conversation, while bounding
   * total open connections at MAX_POOLS * POOL_CONNECTION_LIMIT.
   */
  private static readonly MAX_POOLS = 8;

  constructor(
    private readonly configLoader: ConfigurationLoader = new EnvironmentConfigLoader(),
    private readonly logger: (message: string) => void = (message) =>
      console.error(`[mcp-mysql-ro] ${message}`)
  ) {}

  public create(): McpMySqlServer {
    const config = this.configLoader.load();

    // Warnings are collected by the loader and emitted here, so configuration
    // parsing stays pure and testable while the operator still sees problems.
    for (const warning of config.warnings) {
      this.logger(warning);
    }

    const registry = new ConnectionRegistry(config.profiles);
    const selectionWarning = registry.selectInitial(config.defaultProfileName);
    if (selectionWarning) {
      this.logger(selectionWarning);
    }
    this.reportActiveConnection(registry);

    const pools = new ConnectionPoolManager(
      {
        connectionLimit: ApplicationFactory.POOL_CONNECTION_LIMIT,
        connectTimeoutMs: config.connectTimeoutMs,
        queryTimeoutMs: config.queryTimeoutMs,
        maxPools: ApplicationFactory.MAX_POOLS,
      },
      new SessionInitializer(config.queryTimeoutMs, this.logger)
    );

    const connections = new ConnectionManager(registry, pools);
    const queries = new QueryExecutor(registry, pools);

    const tools = this.createTools(connections, queries);

    return new McpMySqlServer(tools, pools, this.logger);
  }

  private createTools(
    connections: ConnectionManager,
    queries: QueryExecutor
  ): BaseTool<never>[] {
    const identifiers = new IdentifierValidator();
    const targetFactory = new ConnectionTargetFactory();
    const queryValidator = new ReadOnlyQueryValidator();
    const rows = new RowFormatter();

    const tools = [
      new CurrentConnectionTool(connections),
      new ListConnectionsTool(connections),
      new ListDatabasesTool(connections, queries),
      new UseDatabaseTool(connections, identifiers),
      new UseConnectionTool(connections, identifiers),
      new ConnectTool(connections, targetFactory, identifiers),
      new ListTablesTool(identifiers, queries),
      new DescribeTableTool(identifiers, queries),
      new GetTableIndexesTool(identifiers, queries),
      new GetForeignKeysTool(identifiers, queries),
      new GetTableSampleTool(identifiers, queries),
      new RunQueryTool(identifiers, queries, queryValidator, rows),
    ];

    // Each tool is typed by its own argument shape; the server only needs to
    // register them, so they are collected behind the common base type.
    return tools as unknown as BaseTool<never>[];
  }

  private reportActiveConnection(registry: ConnectionRegistry): void {
    const active = registry.getActiveTarget();
    if (active) {
      this.logger(`active connection: ${registry.getActiveName()} (${active.describe()})`);
      return;
    }
    this.logger("no connection configured, call the connect tool to set one");
  }
}
