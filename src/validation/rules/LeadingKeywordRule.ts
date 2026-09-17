import type { QueryInspection, ValidationResult, ValidationRule } from "../../types/validation.types.js";

/**
 * Requires the statement to begin with a keyword that reads rather than writes.
 *
 * WITH is included because rejecting CTEs outright is a real loss on a
 * read-only analysis tool. That inclusion is exactly why SmuggledWriteRule
 * exists, since MySQL 8 allows a CTE to prefix an UPDATE or DELETE.
 */
export class LeadingKeywordRule implements ValidationRule {
  public readonly name = "leading-keyword";

  public static readonly ALLOWED = new Set([
    "SELECT",
    "WITH",
    "SHOW",
    "DESCRIBE",
    "DESC",
    "EXPLAIN",
  ]);

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    if (LeadingKeywordRule.ALLOWED.has(inspection.leadingKeyword)) {
      return null;
    }

    // Naming the offending keyword matters: a model told precisely what was
    // wrong usually rewrites the query correctly without further prompting.
    return {
      valid: false,
      error: `Only SELECT, WITH, SHOW, DESCRIBE, DESC and EXPLAIN are allowed. Got: ${inspection.leadingKeyword}`,
    };
  }
}
