import { z } from "zod";
import type { ZodRawShape } from "zod";
import { BaseTool } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { QueryExecutor } from "../../database/QueryExecutor.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import type { ToolResult } from "../../types/tool.types.js";

interface ListDatabasesArgs {
  readonly include_system: boolean;
}

/** Lists databases on the connected server, marking the active one. */
export class ListDatabasesTool extends BaseTool<ListDatabasesArgs> {
  public readonly name = "list_databases";
  public readonly description = "List databases on the currently connected MySQL server";

  /**
   * These four are noise in almost every session and make it harder to spot
   * the database you actually want. `include_system` exists because inspecting
   * them is occasionally the real task.
   */
  private static readonly SYSTEM_SCHEMAS = new Set([
    "information_schema",
    "performance_schema",
    "mysql",
    "sys",
  ]);

  public readonly inputSchema: ZodRawShape = {
    include_system: z
      .boolean()
      .default(false)
      .describe("Include information_schema, performance_schema, mysql and sys"),
  };

  constructor(
    private readonly connections: ConnectionManager,
    private readonly queries: QueryExecutor
  ) {
    super();
  }

  protected async execute(args: ListDatabasesArgs): Promise<ToolResult> {
    const rows = (await this.queries.execute("SHOW DATABASES")) as Record<string, string>[];
    const active = this.connections.requireActiveTarget();

    const names = rows
      .map((row) => Object.values(row)[0])
      .filter((name) => args.include_system || !ListDatabasesTool.SYSTEM_SCHEMAS.has(name));

    const lines = names.map((name) => (name === active.database ? `* ${name}` : `  ${name}`));

    return ToolResponse.text(`Databases (${names.length}):\n${lines.join("\n")}`);
  }
}
