import { ConnectionProfile } from "../domain/ConnectionProfile.js";
import { ConnectionTargetFactory } from "../connections/ConnectionTargetFactory.js";
import type { ConfigurationLoader, LoadedConfiguration } from "../types/config.types.js";
import type { RawProfileDefinition } from "../types/connection.types.js";

/**
 * Reads configuration from environment variables.
 *
 * Implements ConfigurationLoader so tests, and any future file or remote
 * source, can be substituted without touching anything downstream.
 *
 * Two properties are deliberate:
 *
 * - **Nothing is logged here.** Problems are returned as `warnings` and the
 *   composition root decides where they go. That keeps the loader pure, and
 *   lets tests assert on warnings instead of intercepting console output.
 * - **Nothing is fatal.** Malformed JSON, a broken profile, or no
 *   configuration at all all produce a usable result. A server that starts and
 *   explains the problem can be fixed with the connect tool; one that exits
 *   during handshake is reported by the client as a broken install.
 */
export class EnvironmentConfigLoader implements ConfigurationLoader {
  public static readonly DEFAULT_QUERY_TIMEOUT_MS = 30000;
  public static readonly DEFAULT_CONNECT_TIMEOUT_MS = 10000;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly targetFactory: ConnectionTargetFactory = new ConnectionTargetFactory()
  ) {}

  public load(): LoadedConfiguration {
    const warnings: string[] = [];
    const profiles = new Map<string, ConnectionProfile>();

    this.loadNamedProfiles(profiles, warnings);
    this.loadSingleConnectionFallback(profiles);

    return {
      profiles: Array.from(profiles.values()),
      defaultProfileName: this.env.MYSQL_DEFAULT_PROFILE || null,
      queryTimeoutMs: this.readTimeout(
        this.env.MYSQL_QUERY_TIMEOUT_MS,
        EnvironmentConfigLoader.DEFAULT_QUERY_TIMEOUT_MS
      ),
      connectTimeoutMs: this.readTimeout(
        this.env.MYSQL_CONNECT_TIMEOUT_MS,
        EnvironmentConfigLoader.DEFAULT_CONNECT_TIMEOUT_MS
      ),
      warnings,
    };
  }

  private loadNamedProfiles(target: Map<string, ConnectionProfile>, warnings: string[]): void {
    const raw = this.env.MYSQL_PROFILES;
    if (!raw) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      warnings.push(`MYSQL_PROFILES is not valid JSON, ignoring it: ${this.reason(error)}`);
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      warnings.push("MYSQL_PROFILES must be a JSON object of named profiles, ignoring it.");
      return;
    }

    for (const [name, definition] of Object.entries(parsed as Record<string, unknown>)) {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
        warnings.push(`Skipping profile "${name}": not an object.`);
        continue;
      }
      try {
        const connection = this.targetFactory.create(definition as RawProfileDefinition, name);
        target.set(name, ConnectionProfile.fromEnvironment(name, connection));
      } catch (error) {
        warnings.push(`Skipping profile "${name}": ${this.reason(error)}`);
      }
    }
  }

  /**
   * The MYSQL_HOST/USER/DATABASE form used by conventional fixed-connection
   * MySQL MCP servers, registered as a profile named `default`.
   *
   * This is what makes the image a drop-in replacement: an existing config
   * keeps working, and the switching is discovered later. It never overwrites a
   * `default` defined in MYSQL_PROFILES, since explicit configuration wins.
   */
  private loadSingleConnectionFallback(target: Map<string, ConnectionProfile>): void {
    const user = this.env.MYSQL_USER;
    const database = this.env.MYSQL_DATABASE;

    if (!user || !database || target.has("default")) {
      return;
    }

    const connection = this.targetFactory.createFromValues({
      host: this.env.MYSQL_HOST,
      port: this.env.MYSQL_PORT ? Number.parseInt(this.env.MYSQL_PORT, 10) : undefined,
      user,
      password: this.env.MYSQL_PASSWORD ?? "",
      database,
    });

    target.set("default", ConnectionProfile.fromEnvironment("default", connection));
  }

  private readTimeout(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
