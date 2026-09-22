import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { BaseTool } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import type { ToolResult } from "../../types/tool.types.js";

interface UseConnectionArgs {
  readonly profile: string;
  readonly database?: string;
}

/**
 * Switches to a named profile, optionally overriding its database.
 *
 * The override composes two ideas that would otherwise take two calls: "go to
 * staging, but the analytics schema".
 */
export class UseConnectionTool extends BaseTool<UseConnectionArgs> {
  public readonly name = "use_connection";
  public readonly description =
    "Switch to a named connection profile. Takes effect immediately, no restart needed";

  public readonly inputSchema: ZodRawShape = {
    profile: z.string().describe("Profile name from list_connections"),
    database: z
      .string()
      .optional()
      .describe("Optional database to use instead of the profile's own database"),
  };

  /**
   * Repoints the reading tools at another server, so not read-only. No data is
   * altered and repeating the call is a no-op, hence not destructive and
   * idempotent.
   */
  public readonly annotations: ToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  constructor(
    private readonly connections: ConnectionManager,
    private readonly identifiers: IdentifierValidator
  ) {
    super();
  }

  protected async execute(args: UseConnectionArgs): Promise<ToolResult> {
    if (args.database) {
      const check = this.identifiers.validate(args.database, "database name");
      if (!check.valid) {
        return ToolResponse.failure(check.error ?? "Invalid database name.");
      }
    }

    // An unknown profile throws UnknownProfileError, which carries the known
    // names; BaseTool turns it into a tool error. When someone mistypes a
    // profile, seeing the real list is the fastest route to the fix.
    const target = await this.connections.useProfile(args.profile, args.database);

    return ToolResponse.text(`Switched to profile "${args.profile}" -> ${target.describe()}`);
  }
}
