import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import { QueryExecutor } from "../../database/QueryExecutor.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface GetForeignKeysArgs extends DatabaseScopedArgs {
  readonly table: string;
}

/** Foreign key relationships for one table. */
export class GetForeignKeysTool extends DatabaseScopedTool<GetForeignKeysArgs> {
  public readonly name = "get_foreign_keys";
  public readonly description = "Show foreign key relationships for a specific table";

  /**
   * Scoped by DATABASE() so it reports the current database only. That
   * resolves to the pool's schema, which stays correct under the per-call
   * database override because the override selects a different pool.
   */
  private static readonly QUERY = `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
           FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`;

  public readonly annotations: ToolHints = {
    title: "Get Foreign Keys",
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

  protected async read(args: GetForeignKeysArgs): Promise<ToolResult> {
    // Validated even though the value is parameterised below, so a bad
    // argument fails the same way across every tool.
    const rejection = this.validateIdentifier(args.table, "table name");
    if (rejection) {
      return rejection;
    }

    // The only read tool using a placeholder: here the table name is a value
    // in a WHERE clause rather than an identifier.
    const rows = (await this.queries.execute(
      GetForeignKeysTool.QUERY,
      [args.table],
      args.database
    )) as unknown[];

    // A sentence rather than []: an empty array reads as "the query failed",
    // a sentence reads as an answer.
    if (rows.length === 0) {
      return ToolResponse.text(`No foreign keys found for table "${args.table}".`);
    }

    return ToolResponse.json(rows);
  }
}
