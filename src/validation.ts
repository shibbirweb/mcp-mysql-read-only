const ALLOWED_LEADING_KEYWORDS = new Set([
  "SELECT",
  "SHOW",
  "DESCRIBE",
  "DESC",
  "EXPLAIN",
  "WITH",
]);

const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|RENAME|CALL|LOAD|HANDLER|LOCK|UNLOCK|INSTALL|UNINSTALL|FLUSH|SHUTDOWN|KILL)\b/i;

const DANGEROUS_PATTERNS = [
  /INTO\s+OUTFILE/i,
  /INTO\s+DUMPFILE/i,
  /LOAD\s+DATA/i,
  /\bBENCHMARK\s*\(/i,
  /\bSLEEP\s*\(/i,
];

const IDENTIFIER_REGEX = /^[A-Za-z0-9_$]+$/;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Replace every string literal, quoted identifier and comment with a single
 * space, so keyword checks only ever see actual SQL structure. Without this a
 * ";" or a keyword hidden inside a literal can fool the checks below.
 */
function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      index += 1;
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
          index += 1;
          break;
        }
        index += 1;
      }
      out += " ";
      continue;
    }

    if (
      char === "-" &&
      sql[index + 1] === "-" &&
      (sql[index + 2] === undefined || /\s/.test(sql[index + 2]))
    ) {
      while (index < sql.length && sql[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (char === "#") {
      while (index < sql.length && sql[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (char === "/" && sql[index + 1] === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

export function validateReadOnlyQuery(sql: string): ValidationResult {
  const skeleton = stripLiteralsAndComments(sql)
    .trim()
    .replace(/;+\s*$/, "")
    .trim();

  if (!skeleton) {
    return { valid: false, error: "Empty query." };
  }

  if (skeleton.includes(";")) {
    return {
      valid: false,
      error: "Multiple statements are not allowed. Send one query at a time.",
    };
  }

  const leading = skeleton.replace(/^[\s(]+/, "").split(/\s+/)[0].toUpperCase();

  if (!ALLOWED_LEADING_KEYWORDS.has(leading)) {
    return {
      valid: false,
      error: `Only SELECT, WITH, SHOW, DESCRIBE, DESC and EXPLAIN are allowed. Got: ${leading}`,
    };
  }

  // A CTE can prefix an UPDATE or DELETE in MySQL 8, and EXPLAIN ANALYZE
  // actually runs the statement. Both need the body checked, unlike a plain
  // SELECT where scanning for these words only produces false rejections on
  // ordinary column names such as "start".
  const needsBodyScan =
    leading === "WITH" || (leading === "EXPLAIN" && /\bANALYZE\b/i.test(skeleton));

  if (needsBodyScan && WRITE_KEYWORDS.test(skeleton)) {
    return {
      valid: false,
      error: "This statement can modify data, which is not allowed on a read-only connection.",
    };
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(skeleton)) {
      return {
        valid: false,
        error: `Query contains a disallowed pattern: ${pattern.source}`,
      };
    }
  }

  return { valid: true };
}

export function validateIdentifier(identifier: string, label: string): ValidationResult {
  if (!identifier || !IDENTIFIER_REGEX.test(identifier)) {
    return {
      valid: false,
      error: `Invalid ${label}: "${identifier}". Only letters, digits, underscore and $ are allowed.`,
    };
  }
  return { valid: true };
}
