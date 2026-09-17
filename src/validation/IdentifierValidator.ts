import type { ValidationResult } from "../types/validation.types.js";

/**
 * Guards identifiers that must be interpolated into SQL.
 *
 * MySQL cannot parameterise a table or database name, so anything reaching
 * `` SHOW COLUMNS FROM `${table}` `` is string interpolation. This allowlist is
 * what makes that safe: nothing matching it can close the backtick, so nothing
 * can escape the quoted identifier.
 *
 * An allowlist rather than a denylist of dangerous characters, because a
 * denylist must be right about every encoding and escape MySQL accepts, while
 * an allowlist need only be right about what a normal identifier looks like.
 *
 * The cost is that identifiers needing quoting (spaces, hyphens, Unicode) are
 * rejected. For those, run_query with a hand-written statement is the escape
 * hatch, and it goes through the full SQL validator instead.
 */
export class IdentifierValidator {
  private static readonly PATTERN = /^[A-Za-z0-9_$]+$/;

  /**
   * @param label names the argument in the message ("table name",
   *   "database name"), because one generic error across six tools leaves the
   *   reader guessing which argument was wrong.
   */
  public validate(identifier: string, label: string): ValidationResult {
    if (!identifier || !IdentifierValidator.PATTERN.test(identifier)) {
      return {
        valid: false,
        error: `Invalid ${label}: "${identifier}". Only letters, digits, underscore and $ are allowed.`,
      };
    }
    return { valid: true };
  }
}
