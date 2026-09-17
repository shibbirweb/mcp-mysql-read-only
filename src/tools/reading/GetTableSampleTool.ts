import { z } from "zod";
import type { ZodRawShape } from "zod";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import { QueryExecutor } from "../../database/QueryExecutor.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface GetTableSampleArgs extends DatabaseScopedArgs {
  readonly table: string;
  readonly limit: number;
}

/** A handful of rows from a table. */
export class GetTableSampleTool extends DatabaseScopedTool<GetTableSampleArgs> {
  public readonly name = "get_table_sample";
  public readonly description = "Get sample rows from a table";

  private static readonly MIN_LIMIT = 1;
  private static readonly MAX_LIMIT = 50;

  public readonly inputSchema: ZodRawShape = {
    table: z.string().describe("Table name"),
    limit: z
      .number()
      .min(GetTableSampleTool.MIN_LIMIT)
      .max(GetTableSampleTool.MAX_LIMIT)
      .default(5)
      .describe("Number of rows to return (1-50, default 5)"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(
    identifiers: IdentifierValidator,
    private readonly queries: QueryExecutor
  ) {
    super(identifiers);
  }

  protected async read(args: GetTableSampleArgs): Promise<ToolResult> {
    const rejection = this.validateIdentifier(args.table, "table name");
    if (rejection) {
      return rejection;
    }

    const rows = await this.queries.execute(
      `SELECT * FROM \`${args.table}\` LIMIT ${this.clampLimit(args.limit)}`,
      undefined,
      args.database
    );

    return ToolResponse.json(rows);
  }

  /**
   * The limit is interpolated because MySQL will not accept a placeholder in
   * LIMIT on every version.
   *
   * Clamping here duplicates the Zod constraint on purpose. The schema is
   * enforced by the client before dispatch; clamping in the handler means a
   * value reaching the query string cannot be anything but an integer in
   * range, however it got here.
   */
  private clampLimit(limit: number): number {
    return Math.min(
      Math.max(Math.trunc(limit), GetTableSampleTool.MIN_LIMIT),
      GetTableSampleTool.MAX_LIMIT
    );
  }
}
