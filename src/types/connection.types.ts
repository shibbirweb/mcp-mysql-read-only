/**
 * Where a profile came from. Surfaced to the user because it says whether the
 * connection will still exist after a restart.
 */
export type ProfileOrigin = "env" | "session";

/** The fully resolved fields of a connection. No optionals by design. */
export interface ConnectionTargetProps {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

/** One entry of the MYSQL_PROFILES JSON, before defaults and validation. */
export interface RawProfileDefinition {
  readonly host?: unknown;
  readonly port?: unknown;
  readonly user?: unknown;
  readonly password?: unknown;
  readonly database?: unknown;
}

/** Everything needed to open a connection that is not part of its identity. */
export interface PoolTuning {
  readonly connectionLimit: number;
  readonly connectTimeoutMs: number;
  readonly queryTimeoutMs: number;
  readonly maxPools: number;
}
