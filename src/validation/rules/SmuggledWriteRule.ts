import type { QueryInspection, ValidationResult, ValidationRule } from "../../types/validation.types.js";

/**
 * Catches writes hidden behind an allowed first keyword.
 *
 * Two forms can do this in MySQL 8:
 *
 * - `WITH c AS (...) DELETE FROM t` is a write whose first word is on the
 *   allowlist.
 * - `EXPLAIN ANALYZE` genuinely executes the statement, unlike plain EXPLAIN,
 *   which only plans it and is therefore left alone.
 *
 * **The scan is deliberately not applied to plain SELECT.** MySQL cannot turn
 * a SELECT into a write, so scanning adds no safety there, and it actively
 * breaks ordinary queries: `SELECT start FROM sessions` contains START and
 * `SELECT begin, end FROM ranges` contains BEGIN. Those are realistic column
 * names. A global scan was tried first and failed on exactly these.
 *
 * The residual cost is that a column named exactly `update` inside a WITH
 * query must be backticked. Narrow, documented, and far cheaper than rejecting
 * common column names everywhere.
 */
export class SmuggledWriteRule implements ValidationRule {
  public readonly name = "smuggled-write";

  private static readonly WRITE_KEYWORDS =
    /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|RENAME|CALL|LOAD|HANDLER|LOCK|UNLOCK|INSTALL|UNINSTALL|FLUSH|SHUTDOWN|KILL)\b/i;

  private static readonly ANALYZE = /\bANALYZE\b/i;

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    if (!this.needsBodyScan(inspection)) {
      return null;
    }

    if (SmuggledWriteRule.WRITE_KEYWORDS.test(inspection.skeleton)) {
      return {
        valid: false,
        error: "This statement can modify data, which is not allowed on a read-only connection.",
      };
    }

    return null;
  }

  private needsBodyScan(inspection: QueryInspection): boolean {
    if (inspection.leadingKeyword === "WITH") {
      return true;
    }
    return (
      inspection.leadingKeyword === "EXPLAIN" && SmuggledWriteRule.ANALYZE.test(inspection.skeleton)
    );
  }
}
