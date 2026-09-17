import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { ToolResponse } from "../formatting/ToolResponse.js";
import type { ToolResult } from "../types/tool.types.js";

/**
 * Template Method base for every tool.
 *
 * `register` and `invoke` are fixed; subclasses supply only `execute`. That
 * makes the error contract impossible to forget, which matters because an MCP
 * server that throws out of a handler can take the client's whole session with
 * it. The procedural version achieved this with a `guard()` helper each
 * handler had to remember to call.
 */
export abstract class BaseTool<TArgs = Record<string, unknown>> {
  /** The name the assistant calls. Must be unique across the server. */
  public abstract readonly name: string;

  /**
   * Written for a language model, not a person: it is the only thing telling
   * the assistant when to reach for this tool. `use_database` ends with "no
   * restart needed" precisely so an assistant does not tell the user to
   * restart.
   */
  public abstract readonly description: string;

  public abstract readonly inputSchema: ZodRawShape;

  protected abstract execute(args: TArgs): Promise<ToolResult>;

  /**
   * The cast is confined to this one line: the SDK derives the callback's
   * argument type from the schema it was given, which it cannot do for a
   * schema held in an abstract property. Every subclass declares its own
   * argument interface, so the type is recovered immediately below.
   */
  public register(server: McpServer): void {
    server.tool(this.name, this.description, this.inputSchema, (args: Record<string, unknown>) =>
      this.invoke(args as TArgs)
    );
  }

  /**
   * The one place a thrown error becomes a tool error.
   *
   * A dropped connection, a MySQL syntax error or an unconfigured server all
   * arrive here and leave as readable text, so the process stays alive and the
   * user can simply try again.
   */
  private async invoke(args: TArgs): Promise<ToolResult> {
    try {
      return await this.execute(args);
    } catch (error) {
      return ToolResponse.failure(error instanceof Error ? error.message : String(error));
    }
  }
}
