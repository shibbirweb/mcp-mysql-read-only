import { z } from "zod";
import type { ZodRawShape } from "zod";
import { BaseTool } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import type { ToolResult } from "../../types/tool.types.js";

interface UseDatabaseArgs {
  readonly database: string;
}

/**
 * Switches schema on the current server.
 *
 * The verify-then-commit ordering lives in ConnectionManager, so this tool
 * cannot get it wrong: a nonexistent database fails the call and leaves the
 * previous connection working.
 */
export class UseDatabaseTool extends BaseTool<UseDatabaseArgs> {
  public readonly name = "use_database";
  public readonly description =
    "Switch the active database on the current MySQL server. Takes effect immediately, no restart needed";

  public readonly inputSchema: ZodRawShape = {
    database: z.string().describe("Database name to switch to"),
  };

  constructor(
    private readonly connections: ConnectionManager,
    private readonly identifiers: IdentifierValidator
  ) {
    super();
  }

  protected async execute(args: UseDatabaseArgs): Promise<ToolResult> {
    const check = this.identifiers.validate(args.database, "database name");
    if (!check.valid) {
      return ToolResponse.failure(check.error ?? "Invalid database name.");
    }

    const target = await this.connections.useDatabase(args.database);
    return ToolResponse.text(`Switched to ${target.describe()}`);
  }
}
