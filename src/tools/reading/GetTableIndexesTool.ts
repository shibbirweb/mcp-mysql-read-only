import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import { QueryExecutor } from "../../database/QueryExecutor.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface GetTableIndexesArgs extends DatabaseScopedArgs {
  readonly table: string;
}

/** Indexes for one table. */
export class GetTableIndexesTool extends DatabaseScopedTool<GetTableIndexesArgs> {
  public readonly name = "get_table_indexes";
  public readonly description = "Show indexes for a specific table";

  public readonly annotations: ToolHints = {
    title: "Get Table Indexes",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    table: z.string().describe("Table name"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(
    identifiers: IdentifierValidator,
    private readonly queries: QueryExecutor
  ) {
    super(identifiers);
  }

  protected async read(args: GetTableIndexesArgs): Promise<ToolResult> {
    const rejection = this.validateIdentifier(args.table, "table name");
    if (rejection) {
      return rejection;
    }

    const rows = await this.queries.execute(
      `SHOW INDEX FROM \`${args.table}\``,
      undefined,
      args.database
    );

    return ToolResponse.json(rows);
  }
}
