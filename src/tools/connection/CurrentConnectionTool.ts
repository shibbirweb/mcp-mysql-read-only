import type { ZodRawShape } from "zod";
import { BaseTool } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import type { ToolResult } from "../../types/tool.types.js";

/** Reports the active server and database. */
export class CurrentConnectionTool extends BaseTool {
  public readonly name = "current_connection";
  public readonly description =
    "Show which MySQL server and database the read-only tools are currently pointed at";
  public readonly inputSchema: ZodRawShape = {};

  constructor(private readonly connections: ConnectionManager) {
    super();
  }

  protected async execute(): Promise<ToolResult> {
    const target = this.connections.getActiveTarget();

    // Reads the nullable accessor rather than the asserting one, so an
    // unconfigured server reports its state as ordinary output instead of an
    // error. Nothing has gone wrong; nothing has been chosen yet.
    if (!target) {
      return ToolResponse.text("No active connection. Call connect or use_connection to set one.");
    }

    // Rendering through describe() is what keeps the password out of output.
    return ToolResponse.text(
      `Active profile: ${this.connections.getActiveName()}\nTarget: ${target.describe()}`
    );
  }
}
