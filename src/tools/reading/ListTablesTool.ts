import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import { QueryExecutor } from "../../database/QueryExecutor.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

/** Lists tables in the active database. */
export class ListTablesTool extends DatabaseScopedTool {
  public readonly name = "list_tables";
  public readonly description = "List all tables in the active database";

  public readonly annotations: ToolHints = {
    title: "List Tables",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(
    identifiers: IdentifierValidator,
    private readonly queries: QueryExecutor
  ) {
    super(identifiers);
  }

  protected async read(args: DatabaseScopedArgs): Promise<ToolResult> {
    const rows = (await this.queries.execute("SHOW TABLES", undefined, args.database)) as Record<
      string,
      string
    >[];

    // SHOW TABLES returns single-key objects whose key name varies with the
    // database (Tables_in_<name>). A plain list is far easier to read and to
    // reference in a follow-up question.
    const tables = rows.map((row) => Object.values(row)[0]);

    return ToolResponse.text(`Tables (${tables.length}):\n${tables.join("\n")}`);
  }
}
