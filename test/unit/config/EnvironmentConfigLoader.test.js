import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EnvironmentConfigLoader } from "../../../dist/config/EnvironmentConfigLoader.js";

/**
 * The loader takes the environment as a constructor argument, so a case is just
 * an object literal. The procedural version read process.env at module scope,
 * which forced tests to re-import the module with a cache-busting query string
 * and to stub console.error to capture warnings. Neither is needed now.
 */
const load = (env) => new EnvironmentConfigLoader(env).load();

const PROFILES = JSON.stringify({
  alpha: { host: "db-a", port: 3307, user: "reader", password: "pw", database: "alpha_db" },
  beta: { user: "reader", database: "beta_db" },
});

const byName = (config, name) => config.profiles.find((profile) => profile.name === name);

describe("named profiles", () => {
  test("loads every profile", () => {
    const names = load({ MYSQL_PROFILES: PROFILES }).profiles.map((p) => p.name);
    assert.deepEqual(names, ["alpha", "beta"]);
  });

  test("keeps explicit host, port and password", () => {
    const alpha = byName(load({ MYSQL_PROFILES: PROFILES }), "alpha").target;
    assert.equal(alpha.host, "db-a");
    assert.equal(alpha.port, 3307);
    assert.equal(alpha.password, "pw");
  });

  test("defaults host, port and password when omitted", () => {
    const beta = byName(load({ MYSQL_PROFILES: PROFILES }), "beta").target;
    assert.equal(beta.host, "host.docker.internal");
    assert.equal(beta.port, 3306);
    assert.equal(beta.password, "");
  });

  test("marks them as coming from the environment", () => {
    assert.equal(byName(load({ MYSQL_PROFILES: PROFILES }), "alpha").origin, "env");
  });

  test("a port given as a string falls back to the default rather than NaN", () => {
    const config = load({
      MYSQL_PROFILES: JSON.stringify({ a: { user: "u", database: "d", port: "3307" } }),
    });
    assert.equal(byName(config, "a").target.port, 3306);
  });
});

describe("malformed configuration warns instead of failing", () => {
  // Nothing here is fatal: a running server can be repaired with connect,
  // while one that exits during handshake cannot be diagnosed at all.
  test("invalid JSON yields no profiles and a warning", () => {
    const config = load({ MYSQL_PROFILES: "{not json" });
    assert.deepEqual(config.profiles, []);
    assert.ok(config.warnings.some((w) => w.includes("not valid JSON")));
  });

  test("a JSON array is rejected with a warning", () => {
    const config = load({ MYSQL_PROFILES: "[]" });
    assert.deepEqual(config.profiles, []);
    assert.ok(config.warnings.some((w) => w.includes("JSON object")));
  });

  test("a profile missing user is skipped, the rest load", () => {
    const config = load({
      MYSQL_PROFILES: JSON.stringify({ good: { user: "u", database: "d" }, bad: { database: "d" } }),
    });
    assert.deepEqual(config.profiles.map((p) => p.name), ["good"]);
    assert.ok(config.warnings.some((w) => w.includes('"bad"') && w.includes("user")));
  });

  test("a profile missing database is skipped", () => {
    const config = load({
      MYSQL_PROFILES: JSON.stringify({ good: { user: "u", database: "d" }, bad: { user: "u" } }),
    });
    assert.deepEqual(config.profiles.map((p) => p.name), ["good"]);
  });

  test("a non-object profile entry is skipped", () => {
    const config = load({
      MYSQL_PROFILES: JSON.stringify({ good: { user: "u", database: "d" }, bad: "nope" }),
    });
    assert.deepEqual(config.profiles.map((p) => p.name), ["good"]);
  });

  test("warnings are returned, never printed", () => {
    // Purity is what makes the assertions above possible.
    const config = load({ MYSQL_PROFILES: "{not json" });
    assert.ok(Array.isArray(config.warnings));
  });
});

describe("the single-connection fallback", () => {
  test("registers a profile named default", () => {
    const config = load({
      MYSQL_USER: "root",
      MYSQL_DATABASE: "solo",
      MYSQL_HOST: "example",
      MYSQL_PORT: "3310",
    });
    const target = byName(config, "default").target;
    assert.equal(target.database, "solo");
    assert.equal(target.host, "example");
    assert.equal(target.port, 3310);
  });

  test("is ignored when user or database is missing", () => {
    assert.deepEqual(load({ MYSQL_USER: "root" }).profiles, []);
    assert.deepEqual(load({ MYSQL_DATABASE: "solo" }).profiles, []);
  });

  test("does not overwrite an explicit default profile", () => {
    const config = load({
      MYSQL_PROFILES: JSON.stringify({ default: { user: "a", database: "from_profiles" } }),
      MYSQL_USER: "b",
      MYSQL_DATABASE: "from_env",
    });
    assert.equal(byName(config, "default").target.database, "from_profiles");
  });
});

describe("timeouts", () => {
  test("default when unset", () => {
    const config = load({});
    assert.equal(config.queryTimeoutMs, 30000);
    assert.equal(config.connectTimeoutMs, 10000);
  });

  test("are read from the environment", () => {
    const config = load({ MYSQL_QUERY_TIMEOUT_MS: "5000", MYSQL_CONNECT_TIMEOUT_MS: "2000" });
    assert.equal(config.queryTimeoutMs, 5000);
    assert.equal(config.connectTimeoutMs, 2000);
  });

  test("nonsense falls back to the default", () => {
    const config = load({ MYSQL_QUERY_TIMEOUT_MS: "soon", MYSQL_CONNECT_TIMEOUT_MS: "-5" });
    assert.equal(config.queryTimeoutMs, 30000);
    assert.equal(config.connectTimeoutMs, 10000);
  });
});

describe("empty environment", () => {
  test("produces a valid, empty configuration", () => {
    const config = load({});
    assert.deepEqual(config.profiles, []);
    assert.equal(config.defaultProfileName, null);
    assert.deepEqual(config.warnings, []);
  });
});
