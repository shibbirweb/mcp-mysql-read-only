import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import { QueryExecutor } from "../../database/QueryExecutor.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface DescribeTableArgs extends DatabaseScopedArgs {
  readonly table: string;
}

/** Columns and types for one table. */
export class DescribeTableTool extends DatabaseScopedTool<DescribeTableArgs> {
  public readonly name = "describe_table";
  public readonly description = "Show columns and schema for a specific table";

  public readonly annotations: ToolHints = {
    title: "Describe Table",
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

  protected async read(args: DescribeTableArgs): Promise<ToolResult> {
    // MySQL cannot parameterise an identifier, so the table name is
    // interpolated and must be validated first. The allowlist is what makes
    // that safe: nothing matching it can close the backtick.
    const rejection = this.validateIdentifier(args.table, "table name");
    if (rejection) {
      return rejection;
    }

    // SHOW COLUMNS rather than an information_schema query: shorter output,
    // and already scoped to the pool's database.
    const rows = await this.queries.execute(
      `SHOW COLUMNS FROM \`${args.table}\``,
      undefined,
      args.database
    );

    return ToolResponse.json(rows);
  }
}
