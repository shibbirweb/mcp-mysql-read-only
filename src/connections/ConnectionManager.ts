import { ConnectionProfile } from "../domain/ConnectionProfile.js";
import { ConnectionTarget } from "../domain/ConnectionTarget.js";
import { ConnectionPoolManager } from "../database/ConnectionPoolManager.js";
import { UnknownProfileError } from "../errors/UnknownProfileError.js";
import { ConnectionRegistry } from "./ConnectionRegistry.js";

/**
 * Orchestrates changing the active connection.
 *
 * Sits between the tools and the registry so that every switch follows the
 * same rule: **verify, then commit**. The registry cannot enforce that itself
 * without taking a dependency on the database, and the tools should not each
 * be trusted to remember it.
 *
 * Committing only after a successful verification is what makes a failed
 * switch harmless: the previous connection stays active and the session
 * remains usable.
 */
export class ConnectionManager {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly pools: ConnectionPoolManager
  ) {}

  public getActiveTarget(): ConnectionTarget | null {
    return this.registry.getActiveTarget();
  }

  public getActiveName(): string | null {
    return this.registry.getActiveName();
  }

  public requireActiveTarget(): ConnectionTarget {
    return this.registry.requireActiveTarget();
  }

  public listProfiles(): ConnectionProfile[] {
    return this.registry.list();
  }

  public knownProfileNames(): string[] {
    return this.registry.names();
  }

  /**
   * Move to a different schema on the current server.
   *
   * Keeps the current profile label: the connection is still "staging", just
   * pointed elsewhere, and renaming it would throw away that context.
   */
  public async useDatabase(database: string): Promise<ConnectionTarget> {
    const candidate = this.registry.requireActiveTarget().withDatabase(database);
    await this.pools.verify(candidate);
    return this.registry.activateTarget(candidate, this.registry.getActiveName() ?? "custom");
  }

  /**
   * Move to a named profile, optionally overriding its database.
   *
   * @throws UnknownProfileError carrying the known names, checked before any
   *   network work so a typo fails instantly.
   */
  public async useProfile(profileName: string, database?: string): Promise<ConnectionTarget> {
    const profile = this.registry.find(profileName);
    if (!profile) {
      throw new UnknownProfileError(profileName, this.registry.names());
    }

    const candidate = database ? profile.target.withDatabase(database) : profile.target;
    await this.pools.verify(candidate);
    return this.registry.activateTarget(candidate, profileName);
  }

  /**
   * Open an arbitrary connection and keep it under an alias for the session.
   *
   * This is what makes a restart unnecessary in every case: MYSQL_PROFILES is
   * a convenience, this is the guarantee. Credentials are held in memory only
   * and vanish on exit, which list_connections communicates via the `session`
   * origin.
   */
  public async connect(target: ConnectionTarget, alias: string): Promise<ConnectionTarget> {
    await this.pools.verify(target);
    this.registry.register(ConnectionProfile.fromSession(alias, target));
    return this.registry.activateTarget(target, alias);
  }
}
