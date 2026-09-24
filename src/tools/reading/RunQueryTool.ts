import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolHints } from "../BaseTool.js";
import { DatabaseScopedTool } from "../DatabaseScopedTool.js";
import { QueryExecutor } from "../../database/QueryExecutor.js";
import { RowFormatter } from "../../formatting/RowFormatter.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import { ReadOnlyQueryValidator } from "../../validation/ReadOnlyQueryValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../../types/tool.types.js";

interface RunQueryArgs extends DatabaseScopedArgs {
  readonly query: string;
}

/**
 * The general escape hatch for reads.
 *
 * No parameter binding is exposed. Adding a `params` argument would let an
 * assistant separate values from SQL properly, but models inline their values
 * in practice, and the validator plus the read-only session already bound what
 * a query can do.
 */
export class RunQueryTool extends DatabaseScopedTool<RunQueryArgs> {
  public readonly name = "run_query";
  public readonly description =
    "Execute a read-only SQL query (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN only) against the active connection";

  public readonly annotations: ToolHints = {
    title: "Run Read-Only Query",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  public readonly inputSchema: ZodRawShape = {
    query: z.string().describe("SQL query to execute"),
    database: DatabaseScopedTool.databaseParam,
  };

  constructor(
    identifiers: IdentifierValidator,
    private readonly queries: QueryExecutor,
    private readonly validator: ReadOnlyQueryValidator,
    private readonly rows: RowFormatter
  ) {
    super(identifiers);
  }

  protected async read(args: RunQueryArgs): Promise<ToolResult> {
    // Validation happens before anything touches the network, so a rejected
    // query costs no connection.
    const check = this.validator.validate(args.query);
    if (!check.valid) {
      return ToolResponse.failure(check.error ?? "Query rejected.");
    }

    const result = (await this.queries.execute(args.query, undefined, args.database)) as unknown[];
    return ToolResponse.text(this.rows.format(result));
  }
}
