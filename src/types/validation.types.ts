/** Outcome of a validation check. `error` is present only when invalid. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

/**
 * A statement reduced to the parts a rule may safely reason about.
 *
 * `skeleton` has every string literal, quoted identifier and comment replaced
 * by whitespace, so a rule inspecting it can never mistake user data for SQL.
 * `raw` is kept only for rules that need the original text; none currently do.
 */
export interface QueryInspection {
  readonly raw: string;
  readonly skeleton: string;
  readonly leadingKeyword: string;
}

/**
 * One check in the read-only chain.
 *
 * Returning `null` means "this rule has no objection", which lets the validator
 * run the chain without each rule knowing about the others.
 */
export interface ValidationRule {
  readonly name: string;
  evaluate(inspection: QueryInspection): ValidationResult | null;
}
