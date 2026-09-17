import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * connections.js reads the environment once at import time, so each case needs
 * its own module instance. A query string makes the ESM loader treat the
 * specifier as distinct and re-evaluate the module.
 */
let counter = 0;

async function load(env = {}) {
  const previous = {};
  const keys = [
    "MYSQL_PROFILES",
    "MYSQL_DEFAULT_PROFILE",
    "MYSQL_HOST",
    "MYSQL_PORT",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "MYSQL_DATABASE",
  ];

  for (const key of keys) {
    previous[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(" "));

  let module;
  try {
    module = await import(`../../dist/connections.js?case=${counter++}`);
  } finally {
    console.error = originalError;
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }

  return { module, logs };
}

// alpha sets every field explicitly; beta omits host, port and password so the
// defaults are covered too.
const PROFILES = JSON.stringify({
  alpha: { host: "db-a", port: 3307, user: "reader", password: "pw", database: "alpha_db" },
  beta: { user: "reader", database: "beta_db" },
});

describe("profile loading from MYSQL_PROFILES", () => {
  test("loads every profile", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    const names = module.listProfiles().map((p) => p.name).sort();
    assert.deepEqual(names, ["alpha", "beta"]);
  });

  test("keeps explicit host and port", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    const alpha = module.getProfile("alpha");
    assert.equal(alpha.target.host, "db-a");
    assert.equal(alpha.target.port, 3307);
    assert.equal(alpha.target.password, "pw");
  });

  test("defaults host, port and password when omitted", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    const beta = module.getProfile("beta");
    assert.equal(beta.target.host, "host.docker.internal");
    assert.equal(beta.target.port, 3306);
    assert.equal(beta.target.password, "");
  });

  test("marks env profiles with their origin", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    assert.equal(module.getProfile("alpha").origin, "env");
  });
});

describe("profile loading is forgiving", () => {
  // A broken profile must not take the whole server down: the tools can still
  // reach everything else, and connect can always open something by hand.
  test("invalid JSON leaves the server running with no profiles", async () => {
    const { module, logs } = await load({ MYSQL_PROFILES: "{not json" });
    assert.deepEqual(module.listProfiles(), []);
    assert.equal(module.getActiveTarget(), null);
    assert.ok(logs.some((line) => line.includes("not valid JSON")));
  });

  test("a profile missing user is skipped, the rest load", async () => {
    const { module, logs } = await load({
      MYSQL_PROFILES: JSON.stringify({
        good: { user: "reader", database: "d" },
        bad: { database: "d" },
      }),
    });
    assert.deepEqual(module.listProfiles().map((p) => p.name), ["good"]);
    assert.ok(logs.some((line) => line.includes('"bad"') && line.includes("user")));
  });

  test("a profile missing database is skipped", async () => {
    const { module } = await load({
      MYSQL_PROFILES: JSON.stringify({
        good: { user: "reader", database: "d" },
        bad: { user: "reader" },
      }),
    });
    assert.deepEqual(module.listProfiles().map((p) => p.name), ["good"]);
  });

  test("a non-object profile entry is skipped", async () => {
    const { module } = await load({
      MYSQL_PROFILES: JSON.stringify({ good: { user: "u", database: "d" }, bad: "nope" }),
    });
    assert.deepEqual(module.listProfiles().map((p) => p.name), ["good"]);
  });
});

describe("the single-connection env fallback", () => {
  test("becomes a profile named default", async () => {
    const { module } = await load({
      MYSQL_USER: "root",
      MYSQL_DATABASE: "solo",
      MYSQL_HOST: "example",
      MYSQL_PORT: "3310",
    });
    const profile = module.getProfile("default");
    assert.equal(profile.target.database, "solo");
    assert.equal(profile.target.host, "example");
    assert.equal(profile.target.port, 3310);
    assert.equal(module.getActiveName(), "default");
  });

  test("is ignored when user or database is missing", async () => {
    const { module } = await load({ MYSQL_USER: "root" });
    assert.deepEqual(module.listProfiles(), []);
  });

  test("does not overwrite an explicit default profile", async () => {
    const { module } = await load({
      MYSQL_PROFILES: JSON.stringify({ default: { user: "a", database: "from_profiles" } }),
      MYSQL_USER: "b",
      MYSQL_DATABASE: "from_env",
    });
    assert.equal(module.getProfile("default").target.database, "from_profiles");
  });
});

describe("choosing the starting profile", () => {
  test("honours MYSQL_DEFAULT_PROFILE", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES, MYSQL_DEFAULT_PROFILE: "beta" });
    assert.equal(module.getActiveName(), "beta");
  });

  test("warns and falls back when it names an unknown profile", async () => {
    const { module, logs } = await load({
      MYSQL_PROFILES: PROFILES,
      MYSQL_DEFAULT_PROFILE: "ghost",
    });
    assert.ok(logs.some((line) => line.includes("ghost")));
    assert.equal(module.getActiveName(), "alpha");
  });

  test("prefers a profile named default", async () => {
    const { module } = await load({
      MYSQL_PROFILES: JSON.stringify({
        zebra: { user: "u", database: "z" },
        default: { user: "u", database: "d" },
      }),
    });
    assert.equal(module.getActiveName(), "default");
  });

  test("otherwise takes the first profile", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    assert.equal(module.getActiveName(), "alpha");
  });

  test("starts with nothing active when no profiles exist", async () => {
    const { module } = await load({});
    assert.equal(module.getActiveTarget(), null);
    assert.throws(() => module.requireActiveTarget(), /No active connection/);
  });
});

describe("switching the active connection", () => {
  test("setActiveProfile points at that profile", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    module.setActiveProfile("beta");
    assert.equal(module.getActiveName(), "beta");
    assert.equal(module.getActiveTarget().database, "beta_db");
  });

  test("setActiveProfile rejects an unknown name", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    assert.throws(() => module.setActiveProfile("ghost"), /Unknown profile/);
  });

  test("the active target is a copy, so mutating it cannot corrupt the profile", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    module.setActiveProfile("alpha");
    module.getActiveTarget().database = "tampered";
    assert.equal(module.getProfile("alpha").target.database, "alpha_db");
  });

  test("addSessionProfile registers an alias tagged as session", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    module.addSessionProfile("adhoc", {
      host: "h",
      port: 3306,
      user: "u",
      password: "",
      database: "d",
    });
    assert.equal(module.getProfile("adhoc").origin, "session");
  });

  test("withDatabase changes only the database", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    const alpha = module.getProfile("alpha").target;
    const moved = module.withDatabase(alpha, "other");
    assert.equal(moved.database, "other");
    assert.equal(moved.host, alpha.host);
    assert.equal(moved.user, alpha.user);
    assert.equal(alpha.database, "alpha_db", "source target must not be mutated");
  });
});

describe("describeTarget", () => {
  test("renders user, host, port and database", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    const rendered = module.describeTarget(module.getProfile("alpha").target);
    assert.equal(rendered, "reader@db-a:3307/alpha_db");
  });

  test("never includes the password", async () => {
    const { module } = await load({ MYSQL_PROFILES: PROFILES });
    const rendered = module.describeTarget(module.getProfile("alpha").target);
    assert.ok(!rendered.includes("pw"), `password leaked into "${rendered}"`);
  });
});
