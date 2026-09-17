# Read Only Enforcement

Source: `src/validation.ts`

Pure functions, no imports, no state. Given a string, decide whether it may run. This is the layer most worth understanding before changing anything, because each rule here exists to close a specific hole.

## The threat model

The statements reaching `run_query` are written by a language model, usually from a user's plain-English request. The realistic risk is not a determined attacker with a crafted payload; it is a model that misreads "clean up the test rows" as a licence to `DELETE`, or a user who pastes a migration script.

That shapes the design in two ways. False rejections are expensive, because a query wrongly refused makes the tool feel broken and people work around it. And the guard does not need to survive an adversary who already has write credentials and a MySQL client; it needs to make an accidental write impossible through this path.

## `stripLiteralsAndComments(sql)`

A small hand-written scanner that replaces every string literal, quoted identifier and comment with a single space, returning a *skeleton* of the statement's structure. Every check below runs on the skeleton; the original string is what actually reaches MySQL.

It handles `'...'`, `"..."`, `` `...` ``, backslash escapes, doubled-quote escapes (`'it''s'`), `-- ` line comments, `#` line comments and `/* */` block comments.

Why bother rather than using regular expressions on the raw SQL:

**A naive splitter is wrong in both directions.** Splitting on `;` rejects `SELECT 'a;b'`, an ordinary query, while a `;` inside a comment can hide a second statement from a check that strips comments imperfectly.

**Keyword scanning is worse.** `SELECT * FROM t WHERE status = 'DELETE'` contains the word DELETE. So does a column named `` `delete` ``. Blanking literals and quoted identifiers first means the scanner only ever sees real syntax, which is what makes the write-keyword check below usable at all.

Backtick contents are blanked for exactly this reason: an identifier deliberately named after a keyword should be invisible to keyword checks.

Note that a line comment is only recognised when `--` is followed by whitespace or end of input, matching MySQL, so `SELECT 1--2` stays an arithmetic expression.

The scanner is character-by-character rather than regex-based because these constructs nest and escape in ways regular expressions cannot express correctly. A regex approach was tried and dropped; the failure mode was false rejections on ordinary queries, which is the worst outcome for this tool.

## `validateReadOnlyQuery(sql)`

Five checks, in order.

### 1. Empty

After stripping and trimming a trailing `;`, an empty skeleton is rejected. Catches the empty string, whitespace, a bare semicolon and a statement that was nothing but a comment.

### 2. Statement stacking

Any remaining `;` in the skeleton is rejected. Because literals and comments are already blank, this is the real separator count.

A single trailing semicolon is stripped first, since people paste queries that way and it is harmless.

This check is a better error message rather than the actual protection: `multipleStatements: false` in `db.ts` means the driver cannot send a second statement regardless. See [Connection Pooling](Connection-Pooling).

### 3. Leading keyword

The first word must be `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `DESC` or `EXPLAIN`.

Leading `(` characters are stripped first so `(SELECT 1) UNION (SELECT 2)` is recognised.

`WITH` is included because rejecting CTEs outright is a real usability loss on a read-only tool; analytical queries are exactly what people use this for. That inclusion is what makes check 4 necessary.

The error names the offending keyword (`Got: DELETE`), because a model that gets told specifically what was wrong will usually rewrite the query correctly on its own.

### 4. Write keywords, but only where they can hide

```ts
const needsBodyScan =
  leading === "WITH" || (leading === "EXPLAIN" && /\bANALYZE\b/i.test(skeleton));
```

Only these two forms have their bodies scanned for write keywords, and the reasoning is the crux of this file.

**`WITH` needs it.** MySQL 8 allows `WITH c AS (...) DELETE FROM t`. The first word is on the allowlist while the statement writes.

**`EXPLAIN ANALYZE` needs it.** Plain `EXPLAIN DELETE ...` only plans the statement and is safe, which is why it is allowed. `EXPLAIN ANALYZE` genuinely executes it.

**A plain `SELECT` must not be scanned.** MySQL cannot turn a `SELECT` into a write, so the scan adds no safety, and it actively breaks ordinary queries. `SELECT start FROM sessions` contains the word START. `SELECT begin, end FROM ranges` contains BEGIN. Those are realistic column names, and rejecting them would be a bug. A global scan was tried first and failed on exactly these.

The residual cost is that a column named exactly `update` inside a `WITH` query is rejected unless backticked. Narrow, documented, and far cheaper than the alternative.

### 5. Dangerous patterns

`INTO OUTFILE`, `INTO DUMPFILE`, `LOAD DATA`, `SLEEP()` and `BENCHMARK()`.

The first three write files on the database server, which is a write even though the statement starts with `SELECT`, and is the classic way to turn read access into something worse.

`SLEEP` and `BENCHMARK` are not security issues; they hang the conversation. Blocking them is a blunt availability guard, and it is the one rule here that will occasionally annoy someone legitimately benchmarking. That is documented in the README rather than solved, because the alternative is a query that never returns.

## `validateIdentifier(identifier, label)`

Requires `^[A-Za-z0-9_$]+$`.

MySQL cannot parameterise identifiers, so a table name reaching `SHOW COLUMNS FROM \`${table}\`` is string interpolation. This allowlist is what makes that safe: nothing matching it can close the backtick, so nothing can escape the quoted identifier.

An allowlist rather than a denylist of dangerous characters, because a denylist has to be right about every encoding and escape MySQL accepts, and an allowlist only has to be right about what a normal identifier looks like.

The consequence is that identifiers needing quoting (spaces, hyphens, Unicode) are rejected. For those, `run_query` with a hand-written query is the escape hatch, and it goes through the full SQL validator instead.

The `label` parameter puts the right noun in the error (`Invalid database name` versus `Invalid table name`), since one generic message across six tools makes it unclear which argument was wrong.

## Changing the rules

- **Allowing a new leading keyword** means asking whether it can carry a write. If so, add it to the `needsBodyScan` condition.
- **Adding to `WRITE_KEYWORDS`** is low risk, since the scan only applies to `WITH` and `EXPLAIN ANALYZE`.
- **Adding to `DANGEROUS_PATTERNS`** applies to every statement, so a sloppy pattern causes false rejections everywhere.
- **Any change here needs unit tests on both sides**: the thing it blocks, and an ordinary query it must not block. `test/unit/validation.test.js` is organised that way, and the "literals are not read as SQL" and "reads that must be allowed" blocks exist specifically to catch over-rejection.
