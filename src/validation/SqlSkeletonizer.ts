/**
 * Reduces a statement to its syntactic skeleton by blanking every string
 * literal, quoted identifier and comment.
 *
 * Its own class because every rule depends on it and none should re-implement
 * it. It is the foundation of the whole read-only guard: rules inspecting the
 * skeleton can never mistake user data for SQL.
 *
 * Written as a character scanner rather than regular expressions because these
 * constructs nest and escape in ways regular expressions cannot express
 * correctly. A regex version was tried and rejected; its failure mode was
 * false rejections of ordinary queries, which is the worst outcome here.
 */
export class SqlSkeletonizer {
  /**
   * @returns the statement with literals, quoted identifiers and comments
   *   replaced by whitespace, preserving offsets closely enough for keyword
   *   and separator checks.
   */
  public skeletonize(sql: string): string {
    let out = "";
    let index = 0;

    while (index < sql.length) {
      const char = sql[index];

      if (char === "'" || char === '"' || char === "`") {
        index = this.skipQuoted(sql, index);
        // Backtick contents are blanked along with string literals, so a
        // column deliberately named after a keyword is invisible to the
        // keyword rules.
        out += " ";
        continue;
      }

      if (this.startsLineComment(sql, index)) {
        index = this.skipToLineEnd(sql, index);
        continue;
      }

      if (char === "/" && sql[index + 1] === "*") {
        index = this.skipBlockComment(sql, index);
        continue;
      }

      out += char;
      index += 1;
    }

    return out;
  }

  /** Handles backslash escapes and the doubled-quote form (`'it''s'`). */
  private skipQuoted(sql: string, start: number): number {
    const quote = sql[start];
    let index = start + 1;

    while (index < sql.length) {
      if (sql[index] === "\\" && quote !== "`") {
        index += 2;
        continue;
      }
      if (sql[index] === quote) {
        if (sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        return index + 1;
      }
      index += 1;
    }

    return index;
  }

  /**
   * MySQL requires whitespace after `--` for a line comment, so `SELECT 1--2`
   * stays an arithmetic expression rather than becoming a comment.
   */
  private startsLineComment(sql: string, index: number): boolean {
    if (sql[index] === "#") {
      return true;
    }
    return (
      sql[index] === "-" &&
      sql[index + 1] === "-" &&
      (sql[index + 2] === undefined || /\s/.test(sql[index + 2]))
    );
  }

  private skipToLineEnd(sql: string, start: number): number {
    let index = start;
    while (index < sql.length && sql[index] !== "\n") {
      index += 1;
    }
    return index;
  }

  private skipBlockComment(sql: string, start: number): number {
    let index = start + 2;
    while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
      index += 1;
    }
    return index + 2;
  }
}
