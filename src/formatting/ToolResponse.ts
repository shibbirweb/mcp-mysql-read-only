import type { ToolResult } from "../types/tool.types.js";

/**
 * Builds MCP tool results.
 *
 * Static factories rather than an instance, because there is no state and
 * every tool needs them. Having one place that constructs the content envelope
 * means `isError` is set consistently and no handler hand-rolls the shape.
 */
export class ToolResponse {
  public static text(body: string): ToolResult {
    return { content: [{ type: "text", text: body }] };
  }

  public static json(value: unknown): ToolResult {
    return ToolResponse.text(JSON.stringify(value, null, 2));
  }

  /**
   * The `Error: ` prefix is load-bearing. An assistant reads tool output to
   * decide what to do next, and an unprefixed message is easily mistaken for
   * data rather than a failure.
   */
  public static failure(body: string): ToolResult {
    return { content: [{ type: "text", text: `Error: ${body}` }], isError: true };
  }
}
