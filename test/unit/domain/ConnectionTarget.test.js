import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConnectionTarget } from "../../../dist/domain/ConnectionTarget.js";

const props = {
  host: "db-a",
  port: 3307,
  user: "reader",
  password: "pw",
  database: "alpha_db",
};

const target = () => new ConnectionTarget(props);

describe("identity", () => {
  test("key renders user, host, port and database", () => {
    assert.equal(target().key(), "reader@db-a:3307/alpha_db");
  });

  test("describe matches the key, so display and identity cannot drift", () => {
    const value = target();
    assert.equal(value.describe(), value.key());
  });

  test("the password never appears in the key", () => {
    assert.ok(!target().key().includes("pw"));
  });

  test("equal values are equal", () => {
    assert.ok(target().equals(new ConnectionTarget(props)));
  });

  test("a different database is a different connection", () => {
    assert.ok(!target().equals(target().withDatabase("other")));
  });

  test("a different password is not the same connection", () => {
    const other = new ConnectionTarget({ ...props, password: "different" });
    assert.ok(!target().equals(other));
  });

  test("two targets differing only by database produce different keys", () => {
    // If these collided, the pool cache would hand back the wrong schema.
    assert.notEqual(target().key(), target().withDatabase("other").key());
  });
});

describe("immutability", () => {
  // This is the property that made the procedural version fragile: a missed
  // defensive copy meant mutating the active connection rewrote the profile it
  // came from. There is no setter to forget now.
  test("fields cannot be reassigned", () => {
    const value = target();
    assert.throws(() => {
      value.database = "tampered";
    }, TypeError);
  });

  test("withDatabase leaves the original untouched", () => {
    const original = target();
    const moved = original.withDatabase("other");
    assert.equal(original.database, "alpha_db");
    assert.equal(moved.database, "other");
  });

  test("withDatabase carries every other field across", () => {
    const moved = target().withDatabase("other");
    assert.equal(moved.host, props.host);
    assert.equal(moved.port, props.port);
    assert.equal(moved.user, props.user);
    assert.equal(moved.password, props.password);
  });

  test("toProps round-trips", () => {
    assert.ok(new ConnectionTarget(target().toProps()).equals(target()));
  });
});
