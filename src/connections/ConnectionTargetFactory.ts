import { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { InvalidProfileDefinitionError } from "../errors/InvalidProfileDefinitionError.js";
import type { RawProfileDefinition } from "../types/connection.types.js";

/**
 * Builds ConnectionTarget instances from untrusted input.
 *
 * A Factory rather than a constructor because the input is parsed JSON from an
 * environment variable: every field has to be type-checked, several have
 * defaults, and two are required. Keeping that in one place means the
 * MYSQL_PROFILES path and the single-connection MYSQL_* path cannot drift
 * apart in what they accept.
 */
export class ConnectionTargetFactory {
  /**
   * `localhost` inside a container means the container itself, which is the
   * single most common mistake when the database runs on the host. Defaulting
   * to the Docker host makes the usual setup work with no `host` key at all.
   */
  public static readonly DEFAULT_HOST = "host.docker.internal";
  public static readonly DEFAULT_PORT = 3306;

  /**
   * @throws InvalidProfileDefinitionError when user or database is missing.
   *   The caller turns this into a warning; one broken profile must not stop
   *   the server from starting.
   */
  public create(raw: RawProfileDefinition, profileName: string): ConnectionTarget {
    const user = this.readString(raw.user);
    const database = this.readString(raw.database);

    if (!user) {
      throw new InvalidProfileDefinitionError(profileName, 'is missing "user".');
    }
    if (!database) {
      throw new InvalidProfileDefinitionError(profileName, 'is missing "database".');
    }

    return new ConnectionTarget({
      host: this.readString(raw.host) || ConnectionTargetFactory.DEFAULT_HOST,
      port: this.readPort(raw.port),
      user,
      password: this.readString(raw.password),
      database,
    });
  }

  /** Builds a target from already-trusted values, applying the same defaults. */
  public createFromValues(values: {
    host?: string;
    port?: number;
    user: string;
    password?: string;
    database: string;
  }): ConnectionTarget {
    return new ConnectionTarget({
      host: values.host || ConnectionTargetFactory.DEFAULT_HOST,
      port: values.port ?? ConnectionTargetFactory.DEFAULT_PORT,
      user: values.user,
      password: values.password ?? "",
      database: values.database,
    });
  }

  private readString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  /**
   * Only a real number is accepted. A port given as the string "3306" falls
   * back to the default rather than becoming NaN and failing much later with
   * an unrecognisable error.
   */
  private readPort(value: unknown): number {
    return typeof value === "number" && Number.isInteger(value) && value > 0
      ? value
      : ConnectionTargetFactory.DEFAULT_PORT;
  }
}
