import type { QueryInspection, ValidationResult, ValidationRule } from "../../types/validation.types.js";

/**
 * Rejects stacked statements.
 *
 * Because the skeleton has literals and comments blanked, any remaining `;` is
 * a real separator. A trailing one is already stripped before rules run, since
 * people routinely paste queries that way.
 *
 * This is a better error message rather than the actual protection: the driver
 * runs with multipleStatements disabled, so a second statement cannot reach
 * MySQL regardless of what this rule concludes.
 */
export class SingleStatementRule implements ValidationRule {
  public readonly name = "single-statement";

  public evaluate(inspection: QueryInspection): ValidationResult | null {
    if (inspection.skeleton.includes(";")) {
      return {
        valid: false,
        error: "Multiple statements are not allowed. Send one query at a time.",
      };
    }
    return null;
  }
}
