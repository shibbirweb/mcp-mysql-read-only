import { z } from "zod";
import { BaseTool } from "./BaseTool.js";
import { ToolResponse } from "../formatting/ToolResponse.js";
import { IdentifierValidator } from "../validation/IdentifierValidator.js";
import type { DatabaseScopedArgs, ToolResult } from "../types/tool.types.js";

/**
 * Base for tools that can read from a one-off database.
 *
 * Refines the Template Method one step further: `execute` is implemented here
 * to validate the shared `database` argument, and subclasses supply `read`.
 * Without this, six tools would each repeat the same guard, and a new tool
 * could silently omit it and interpolate an unchecked identifier.
 *
 * The per-call override exists for two reasons: comparing two databases
 * otherwise means switching, reading and switching back, and a call carrying
 * its own database does not depend on shared mutable state, so it cannot be
 * reordered against a switch issued in the same batch.
 */
export abstract class DatabaseScopedTool<
  TArgs extends DatabaseScopedArgs = DatabaseScopedArgs,
> extends BaseTool<TArgs> {
  /** Reused by every subclass so the argument reads identically everywhere. */
  protected static readonly databaseParam = z
    .string()
    .optional()
    .describe(
      "Optional database to read from for this call only, without changing the active connection"
    );

  constructor(protected readonly identifiers: IdentifierValidator) {
    super();
  }

  protected abstract read(args: TArgs): Promise<ToolResult>;

  protected async execute(args: TArgs): Promise<ToolResult> {
    const rejection = this.validateDatabaseArg(args.database);
    if (rejection) {
      return rejection;
    }
    return this.read(args);
  }

  /**
   * @returns a failure result, or null when the argument is absent or valid.
   *   Returning a value rather than throwing keeps "the caller passed
   *   something invalid" distinct from "something failed at runtime".
   */
  protected validateDatabaseArg(database: string | undefined): ToolResult | null {
    if (!database) {
      return null;
    }
    return this.validateIdentifier(database, "database name");
  }

  protected validateIdentifier(value: string, label: string): ToolResult | null {
    const result = this.identifiers.validate(value, label);
    return result.valid ? null : ToolResponse.failure(result.error ?? `Invalid ${label}.`);
  }
}
