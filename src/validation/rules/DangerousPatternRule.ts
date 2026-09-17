import type { QueryInspection, ValidationResult, ValidationRule } from "../../types/validation.types.js";

/**
 * Blocks constructs that are harmful even inside an otherwise read-only
 * statement.
 *
 * `INTO OUTFILE`, `INTO DUMPFILE` and `LOAD DATA` write files on the database
 * server. They begin with SELECT and would pass every rule above, and they are
 * the classic route from read access to something worse.
 *
 * `SLEEP` and `BENCHMARK` are not a security problem; they hang the
 * conversation. Blocking them is a blunt availability guard and the one rule
 * here that will occasionally frustrate someone measuring query cost. That is
 * documented rather than solved, because the alternative is a tool call that
 * never returns.
 *
 * This rule applies to every statement, so a sloppy addition causes false
 * rejections everywhere.
 */
export class DangerousPatternRule implements ValidationRule {
  public readonly name = "dangerous-pattern";

  private static readonly PATTERNS = [
    /INTO\s+OUTFILE/i,
    /INTO\s+DUMPFILE/i,
    /LOAD\s+DATA/i,
    /\bBENCHMARK\s*\(/i,
    /\bSLEEP\s*\(/i,
  ];

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    for (const pattern of DangerousPatternRule.PATTERNS) {
      if (pattern.test(inspection.skeleton)) {
        return {
          valid: false,
          error: `Query contains a disallowed pattern: ${pattern.source}`,
        };
      }
    }
    return null;
  }
}
