import { SqlSkeletonizer } from "./SqlSkeletonizer.js";
import {
  DangerousPatternRule,
  EmptyQueryRule,
  LeadingKeywordRule,
  SingleStatementRule,
  SmuggledWriteRule,
} from "./rules/index.js";
import type { QueryInspection, ValidationResult, ValidationRule } from "../types/validation.types.js";

/**
 * Decides whether a statement may run, by walking a chain of rules.
 *
 * Chain of Responsibility: each rule inspects the statement and either objects
 * or passes. The validator knows nothing about what any rule checks, and a
 * rule knows nothing about the others, so adding or reordering a check is a
 * local change. The procedural version was one function whose five checks were
 * interleaved with the parsing they depended on.
 *
 * Rules are injected, so a test can exercise one in isolation or assemble a
 * chain that is easier to reason about than the production one.
 */
export class ReadOnlyQueryValidator {
  /**
   * Order matters. Empty first so later rules can assume content; leading
   * keyword before the smuggled-write scan, which is conditional on it.
   */
  public static defaultRules(): ValidationRule[] {
    return [
      new EmptyQueryRule(),
      new SingleStatementRule(),
      new LeadingKeywordRule(),
      new SmuggledWriteRule(),
      new DangerousPatternRule(),
    ];
  }

  constructor(
    private readonly skeletonizer: SqlSkeletonizer = new SqlSkeletonizer(),
    private readonly rules: ValidationRule[] = ReadOnlyQueryValidator.defaultRules()
  ) {}

  public validate(sql: string): ValidationResult {
    const inspection = this.inspect(sql);

    for (const rule of this.rules) {
      const objection = rule.evaluate(inspection);
      if (objection) {
        return objection;
      }
    }

    return { valid: true };
  }

  /**
   * Builds the view of the statement every rule shares.
   *
   * Note the original SQL is what eventually reaches MySQL; the skeleton is
   * only ever used to decide whether it may.
   */
  private inspect(sql: string): QueryInspection {
    const skeleton = this.skeletonizer
      .skeletonize(sql)
      .trim()
      // A single trailing semicolon is idiomatic when pasting a query and is
      // not statement stacking.
      .replace(/;+\s*$/, "")
      .trim();

    return {
      raw: sql,
      skeleton,
      leadingKeyword: this.leadingKeyword(skeleton),
    };
  }

  /** Leading parentheses are stripped so `(SELECT 1) UNION (SELECT 2)` works. */
  private leadingKeyword(skeleton: string): string {
    const firstWord = skeleton.replace(/^[\s(]+/, "").split(/\s+/)[0] ?? "";
    return firstWord.toUpperCase();
  }
}
