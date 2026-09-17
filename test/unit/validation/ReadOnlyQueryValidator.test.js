import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReadOnlyQueryValidator } from "../../../dist/validation/ReadOnlyQueryValidator.js";
import { SqlSkeletonizer } from "../../../dist/validation/SqlSkeletonizer.js";
import { EmptyQueryRule } from "../../../dist/validation/rules/EmptyQueryRule.js";
import { LeadingKeywordRule } from "../../../dist/validation/rules/LeadingKeywordRule.js";
import { SingleStatementRule } from "../../../dist/validation/rules/SingleStatementRule.js";

const validator = new ReadOnlyQueryValidator();

const rejects = (sql) => validator.validate(sql).valid === false;
const allows = (sql) => validator.validate(sql).valid === true;

describe("statements that must be rejected", () => {
  const cases = [
    ["plain delete", "DELETE FROM users"],
    ["plain update", "UPDATE users SET name = 'x'"],
    ["plain insert", "INSERT INTO users VALUES (1)"],
    ["drop", "DROP TABLE users"],
    ["truncate", "TRUNCATE users"],
    ["alter", "ALTER TABLE users ADD COLUMN x INT"],
    ["grant", "GRANT ALL ON *.* TO 'x'@'%'"],
    ["call a procedure", "CALL do_something()"],
    ["set a session variable", "SET SESSION transaction_read_only = 0"],
    ["lowercase", "delete from users"],
    ["leading whitespace and newlines", "\n\t  delete from users"],
    ["empty string", ""],
    ["only whitespace", "   \n  "],
    ["only a semicolon", ";"],
    ["only a comment", "-- nothing here"],
  ];

  for (const [name, sql] of cases) {
    test(name, () => {
      assert.ok(rejects(sql), `expected rejection: ${sql}`);
    });
  }
});

describe("statement stacking", () => {
  const cases = [
    ["bare second statement", "SELECT 1; DROP TABLE users"],
    ["hidden behind a block comment", "SELECT 1 /* x */; DROP TABLE users"],
    ["hidden behind a line comment", "SELECT 1 -- x\n; DROP TABLE users"],
    ["hidden behind a hash comment", "SELECT 1 # x\n; DROP TABLE users"],
    ["three statements", "SELECT 1; SELECT 2; SELECT 3"],
    ["write first", "DROP TABLE users; SELECT 1"],
  ];

  for (const [name, sql] of cases) {
    test(name, () => {
      assert.ok(rejects(sql), `expected rejection: ${sql}`);
    });
  }

  test("a trailing semicolon alone is not stacking", () => {
    assert.ok(allows("SELECT 1;"));
    assert.ok(allows("SELECT 1;  \n "));
  });
});

describe("literals are never read as SQL", () => {
  // The skeletonizer earns its keep here. A naive splitter rejects these, and a
  // naive keyword scan rejects the ones carrying write words.
  const cases = [
    ["semicolon inside a literal", "SELECT 'a;b' AS x"],
    ["comment marker inside a literal", "SELECT '-- not a comment' AS x"],
    ["block comment marker inside a literal", "SELECT '/* nope */' AS x"],
    ["write keyword inside a literal", "SELECT * FROM t WHERE status = 'DELETE'"],
    ["write keyword inside a quoted identifier", "SELECT `delete` FROM t"],
    ["escaped quote inside a literal", "SELECT 'it\\'s fine' AS x"],
    ["doubled quote inside a literal", "SELECT 'it''s fine' AS x"],
    ["double quoted string", 'SELECT "a;b" AS x'],
  ];

  for (const [name, sql] of cases) {
    test(name, () => {
      assert.ok(allows(sql), `expected acceptance: ${sql}`);
    });
  }
});

describe("reads that must be allowed", () => {
  const cases = [
    ["select", "SELECT 1"],
    ["lowercase select", "select 1"],
    ["show", "SHOW TABLES"],
    ["describe", "DESCRIBE users"],
    ["desc", "DESC users"],
    ["explain", "EXPLAIN SELECT 1"],
    ["read-only cte", "WITH c AS (SELECT 1 AS n) SELECT * FROM c"],
    ["parenthesised union", "(SELECT 1) UNION (SELECT 2)"],
    ["subquery", "SELECT * FROM a WHERE id IN (SELECT id FROM b)"],
    ["join with comment", "SELECT * /* join */ FROM a JOIN b ON a.id = b.a_id"],
    // These pin the decision not to scan plain SELECT for write keywords.
    ["column named start", "SELECT start FROM sessions"],
    ["column named begin", "SELECT begin, end FROM ranges"],
    ["column named create_at", "SELECT create_at FROM t"],
    ["column named update_url", "SELECT update_url FROM t"],
  ];

  for (const [name, sql] of cases) {
    test(name, () => {
      assert.ok(allows(sql), `expected acceptance: ${sql}`);
    });
  }
});

describe("writes smuggled past a safe first word", () => {
  test("CTE prefixing a delete", () => {
    assert.ok(rejects("WITH c AS (SELECT 1) DELETE FROM users"));
  });

  test("CTE prefixing an update", () => {
    assert.ok(rejects("WITH c AS (SELECT 1) UPDATE users SET name = 'x'"));
  });

  test("EXPLAIN ANALYZE actually runs the statement", () => {
    assert.ok(rejects("EXPLAIN ANALYZE DELETE FROM users"));
  });

  test("plain EXPLAIN does not run it, so it is allowed", () => {
    assert.ok(allows("EXPLAIN DELETE FROM users"));
  });
});

describe("file and load patterns", () => {
  const cases = [
    ["into outfile", "SELECT * FROM users INTO OUTFILE '/tmp/x'"],
    ["into dumpfile", "SELECT * FROM users INTO DUMPFILE '/tmp/x'"],
    ["into outfile with odd spacing", "SELECT 1 INTO   OUTFILE '/tmp/x'"],
    ["sleep", "SELECT SLEEP(10)"],
    ["sleep with a space", "SELECT SLEEP (10)"],
    ["benchmark", "SELECT BENCHMARK(1000000, MD5('x'))"],
  ];

  for (const [name, sql] of cases) {
    test(name, () => {
      assert.ok(rejects(sql), `expected rejection: ${sql}`);
    });
  }
});

describe("error messages", () => {
  test("names the offending keyword", () => {
    assert.match(validator.validate("DELETE FROM users").error, /DELETE/);
  });

  test("explains statement stacking", () => {
    assert.match(validator.validate("SELECT 1; SELECT 2").error, /Multiple statements/i);
  });
});

describe("the rule chain is composable", () => {
  // Injecting rules is the payoff of the Chain of Responsibility: a narrower
  // chain can be assembled and reasoned about in isolation.
  test("a chain without the keyword rule allows a write through", () => {
    const permissive = new ReadOnlyQueryValidator(new SqlSkeletonizer(), [
      new EmptyQueryRule(),
      new SingleStatementRule(),
    ]);
    assert.equal(permissive.validate("DELETE FROM users").valid, true);
  });

  test("rules run in the order given, first objection wins", () => {
    const keywordFirst = new ReadOnlyQueryValidator(new SqlSkeletonizer(), [
      new LeadingKeywordRule(),
      new SingleStatementRule(),
    ]);
    assert.match(keywordFirst.validate("DELETE FROM a; SELECT 1").error, /Got: DELETE/);

    const stackingFirst = new ReadOnlyQueryValidator(new SqlSkeletonizer(), [
      new SingleStatementRule(),
      new LeadingKeywordRule(),
    ]);
    assert.match(stackingFirst.validate("DELETE FROM a; SELECT 1").error, /Multiple statements/);
  });

  test("an empty chain allows anything, proving rules are the only gate", () => {
    const none = new ReadOnlyQueryValidator(new SqlSkeletonizer(), []);
    assert.equal(none.validate("DROP TABLE users").valid, true);
  });
});
