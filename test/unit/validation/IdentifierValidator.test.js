import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { IdentifierValidator } from "../../../dist/validation/IdentifierValidator.js";

const validator = new IdentifierValidator();

describe("accepts ordinary identifiers", () => {
  for (const value of ["users", "user_roles", "T1", "a$b", "_leading", "x2"]) {
    test(value, () => {
      assert.equal(validator.validate(value, "table name").valid, true);
    });
  }
});

describe("rejects anything that could escape a backtick", () => {
  const cases = [
    ["empty", ""],
    ["backtick", "users`"],
    ["statement stacking", "users; DROP TABLE x"],
    ["backtick then stacking", "users`; DROP TABLE x; --"],
    ["space", "user roles"],
    ["quote", "users'"],
    ["dash", "user-roles"],
    ["dot qualified", "db.users"],
    ["wildcard", "*"],
    ["newline", "users\nDROP"],
    ["comment marker", "users--"],
  ];

  for (const [name, value] of cases) {
    test(name, () => {
      assert.equal(validator.validate(value, "table name").valid, false);
    });
  }
});

describe("error message", () => {
  test("uses the supplied label", () => {
    assert.match(validator.validate("bad name", "database name").error, /database name/);
  });

  test("echoes the offending value", () => {
    assert.match(validator.validate("bad name", "table name").error, /bad name/);
  });
});
