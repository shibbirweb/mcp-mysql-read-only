import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RowFormatter } from "../../../dist/formatting/RowFormatter.js";

const rows = (count) => Array.from({ length: count }, (_, index) => ({ n: index }));

describe("under the limit", () => {
  const formatter = new RowFormatter(5);

  test("renders every row as JSON", () => {
    assert.deepEqual(JSON.parse(formatter.format(rows(3))), rows(3));
  });

  test("adds no truncation note", () => {
    assert.ok(!formatter.format(rows(3)).includes("Showing"));
  });

  test("exactly at the limit is not truncated", () => {
    assert.ok(!formatter.format(rows(5)).includes("Showing"));
  });

  test("an empty result is still valid JSON", () => {
    assert.deepEqual(JSON.parse(formatter.format([])), []);
  });
});

describe("over the limit", () => {
  const formatter = new RowFormatter(5);
  const output = formatter.format(rows(20));

  test("keeps only the first maxRows", () => {
    const body = output.slice(0, output.indexOf("\n\n---"));
    assert.equal(JSON.parse(body).length, 5);
  });

  test("states the real total, not the truncated count", () => {
    assert.match(output, /Showing 5 of 20 rows/);
  });

  test("names the fix, so the reader knows how to narrow it", () => {
    assert.match(output, /LIMIT/);
  });
});

describe("default limit", () => {
  test("is 100", () => {
    assert.match(new RowFormatter().format(rows(101)), /Showing 100 of 101 rows/);
  });
});
