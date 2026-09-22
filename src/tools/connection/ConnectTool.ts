import { z } from "zod";
import type { ZodRawShape } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { BaseTool } from "../BaseTool.js";
import { ConnectionManager } from "../../connections/ConnectionManager.js";
import { ConnectionTargetFactory } from "../../connections/ConnectionTargetFactory.js";
import { ToolResponse } from "../../formatting/ToolResponse.js";
import { IdentifierValidator } from "../../validation/IdentifierValidator.js";
import type { ToolResult } from "../../types/tool.types.js";

interface ConnectArgs {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly alias?: string;
}

/**
 * Opens an arbitrary server at runtime.
 *
 * This is the tool that makes a restart unnecessary in every case.
 * MYSQL_PROFILES is a convenience; this is the guarantee.
 */
export class ConnectTool extends BaseTool<ConnectArgs> {
  public readonly name = "connect";
  public readonly description =
    "Connect to any MySQL server at runtime with explicit credentials. Not persisted to disk, but kept for the rest of the session under an alias";

  /**
   * Not read-only: it opens a server and stores the alias for the session.
   * Not destructive either, because nothing in any database changes, and
   * re-running the same call lands on the same connection.
   */
  public readonly annotations: ToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };

  /** Used when no alias is given, so repeated ad-hoc connections overwrite. */
  private static readonly DEFAULT_ALIAS = "custom";

  public readonly inputSchema: ZodRawShape = {
    host: z
      .string()
      .default(ConnectionTargetFactory.DEFAULT_HOST)
      // Spelled out because reaching the host's MySQL from inside a container
      // is the most common setup mistake, and a model reading this description
      // usually gets it right unprompted.
      .describe("Hostname. Use host.docker.internal for MySQL on this Mac"),
    port: z.number().int().min(1).max(65535).default(ConnectionTargetFactory.DEFAULT_PORT).describe("Port"),
    user: z.string().describe("MySQL user"),
    password: z.string().default("").describe("MySQL password, empty string if none"),
    database: z.string().describe("Database to open"),
    alias: z
      .string()
      .optional()
      .describe("Name to remember this connection under for use_connection later"),
  };

  constructor(
    private readonly connections: ConnectionManager,
    private readonly targetFactory: ConnectionTargetFactory,
    private readonly identifiers: IdentifierValidator
  ) {
    super();
  }

  protected async execute(args: ConnectArgs): Promise<ToolResult> {
    const check = this.identifiers.validate(args.database, "database name");
    if (!check.valid) {
      return ToolResponse.failure(check.error ?? "Invalid database name.");
    }

    const target = this.targetFactory.createFromValues({
      host: args.host,
      port: args.port,
      user: args.user,
      password: args.password,
      database: args.database,
    });

    const alias = args.alias ?? ConnectTool.DEFAULT_ALIAS;
    await this.connections.connect(target, alias);

    return ToolResponse.text(`Connected as "${alias}" -> ${target.describe()}`);
  }
}
