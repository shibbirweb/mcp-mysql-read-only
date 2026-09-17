import type { ConnectionTargetProps } from "../types/connection.types.js";

/**
 * An immutable value object describing one MySQL connection.
 *
 * Immutability is the point. The previous procedural version passed plain
 * objects around and had to remember to spread-copy on every assignment; a
 * single missed copy meant mutating the active connection silently rewrote the
 * stored profile it came from. Here there is no setter to forget: `withDatabase`
 * returns a new instance and the original cannot change.
 *
 * Identity is defined by the value of every field, exposed through `key()`, so
 * the pool cache can treat two equal targets as the same connection.
 */
export class ConnectionTarget {
  public readonly host: string;
  public readonly port: number;
  public readonly user: string;
  public readonly password: string;
  public readonly database: string;

  constructor(props: ConnectionTargetProps) {
    this.host = props.host;
    this.port = props.port;
    this.user = props.user;
    this.password = props.password;
    this.database = props.database;
    Object.freeze(this);
  }

  /**
   * Stable identity, and the pool cache key.
   *
   * The password is excluded deliberately: it is not part of what makes two
   * connections the same endpoint, and this string is shown to users and
   * written to logs. Because identity and display are the same string by
   * construction, they cannot drift apart.
   *
   * A field added to this class that distinguishes two otherwise identical
   * connections must be added here too, or the second will silently reuse the
   * first one's pool.
   */
  public key(): string {
    return `${this.user}@${this.host}:${this.port}/${this.database}`;
  }

  /** Human-readable form. Same as the key, and safe to print. */
  public describe(): string {
    return this.key();
  }

  public equals(other: ConnectionTarget): boolean {
    return this.key() === other.key() && this.password === other.password;
  }

  /** A copy pointing at a different schema. The receiver is untouched. */
  public withDatabase(database: string): ConnectionTarget {
    return new ConnectionTarget({
      host: this.host,
      port: this.port,
      user: this.user,
      password: this.password,
      database,
    });
  }

  public toProps(): ConnectionTargetProps {
    return {
      host: this.host,
      port: this.port,
      user: this.user,
      password: this.password,
      database: this.database,
    };
  }
}
