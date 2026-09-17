import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SqlSkeletonizer } from "../../../dist/validation/SqlSkeletonizer.js";

const skeletonizer = new SqlSkeletonizer();

const skeleton = (sql) => skeletonizer.skeletonize(sql);

describe("string literals are blanked", () => {
  test("single quoted", () => {
    assert.ok(!skeleton("SELECT 'secret' AS x").includes("secret"));
  });

  test("double quoted", () => {
    assert.ok(!skeleton('SELECT "secret" AS x').includes("secret"));
  });

  test("a semicolon inside a literal does not survive", () => {
    assert.ok(!skeleton("SELECT 'a;b'").includes(";"));
  });

  test("backslash escaped quote does not end the literal early", () => {
    assert.ok(!skeleton("SELECT 'it\\'s; still inside' AS x").includes(";"));
  });

  test("doubled quote does not end the literal early", () => {
    assert.ok(!skeleton("SELECT 'it''s; still inside' AS x").includes(";"));
  });

  test("an unterminated literal consumes the rest rather than leaking", () => {
    assert.ok(!skeleton("SELECT 'unterminated; DROP TABLE t").includes(";"));
  });
});

describe("quoted identifiers are blanked", () => {
  // This is what lets the write-keyword scan run without rejecting a column
  // deliberately named after a keyword.
  test("backticked keyword disappears", () => {
    assert.ok(!/delete/i.test(skeleton("SELECT `delete` FROM t")));
  });
});

describe("comments are blanked", () => {
  test("block comment", () => {
    assert.ok(!skeleton("SELECT 1 /* DROP TABLE t */").includes("DROP"));
  });

  test("line comment with double dash", () => {
    assert.ok(!skeleton("SELECT 1 -- DROP TABLE t").includes("DROP"));
  });

  test("line comment with hash", () => {
    assert.ok(!skeleton("SELECT 1 # DROP TABLE t").includes("DROP"));
  });

  test("a line comment ends at the newline", () => {
    assert.match(skeleton("SELECT 1 -- note\nFROM t"), /FROM t/);
  });

  test("a semicolon hidden in a comment does not survive", () => {
    assert.ok(!skeleton("SELECT 1 /* ; */").includes(";"));
  });
});

describe("MySQL specifics", () => {
  // MySQL requires whitespace after `--`, so this is arithmetic, not a comment.
  test("double dash without whitespace is not a comment", () => {
    assert.match(skeleton("SELECT 1--2"), /1--2/);
  });
});

describe("real syntax survives", () => {
  test("structure is preserved", () => {
    const result = skeleton("SELECT a, b FROM t WHERE x = 'y' ORDER BY a");
    assert.match(result, /SELECT a, b FROM t WHERE x =/);
    assert.match(result, /ORDER BY a/);
  });

  test("separators outside literals survive", () => {
    assert.ok(skeleton("SELECT 1; SELECT 2").includes(";"));
  });
});
