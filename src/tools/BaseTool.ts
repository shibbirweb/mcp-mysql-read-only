import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
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

  /**
   * What the client is allowed to assume before it runs the call.
   *
   * The default is the whole point of this server: every reading tool is
   * incapable of changing anything, so a client may run it without stopping to
   * ask. `ReadOnlyQueryValidator` is what makes that true; this is what says so
   * out loud, and a client that never hears it has to treat `run_query` as if
   * it might drop a table.
   *
   * `openWorldHint` stays true throughout because the answers come from a MySQL
   * server, not from a closed set this process controls.
   *
   * Overridden only by the three tools that repoint the connection.
   */
  public readonly annotations: ToolAnnotations = {
    readOnlyHint: true,
    openWorldHint: true,
  };

  protected abstract execute(args: TArgs): Promise<ToolResult>;

  /**
   * The cast is confined to this one line: the SDK derives the callback's
   * argument type from the schema it was given, which it cannot do for a
   * schema held in an abstract property. Every subclass declares its own
   * argument interface, so the type is recovered immediately below.
   */
  public register(server: McpServer): void {
    server.registerTool(
      this.name,
      {
        description: this.description,
        inputSchema: this.inputSchema,
        annotations: this.annotations,
      },
      (args: Record<string, unknown>) => this.invoke(args as TArgs)
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
