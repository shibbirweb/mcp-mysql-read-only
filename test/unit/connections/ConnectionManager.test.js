import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ConnectionManager } from "../../../dist/connections/ConnectionManager.js";
import { ConnectionRegistry } from "../../../dist/connections/ConnectionRegistry.js";
import { ConnectionProfile } from "../../../dist/domain/ConnectionProfile.js";
import { ConnectionTarget } from "../../../dist/domain/ConnectionTarget.js";

/**
 * A stand-in for ConnectionPoolManager.
 *
 * Injecting the pool manager is what makes these tests possible at all: the
 * verify-then-commit rule is the reason a failed switch is harmless, and
 * before the refactor it could only be exercised against a real MySQL.
 */
class FakePoolManager {
  constructor({ failOn = [] } = {}) {
    this.failOn = failOn;
    this.verified = [];
  }

  async verify(target) {
    this.verified.push(target.key());
    if (this.failOn.includes(target.database)) {
      throw new Error(`Unknown database '${target.database}'`);
    }
  }
}

const target = (database) =>
  new ConnectionTarget({ host: "db", port: 3306, user: "reader", password: "", database });

function build({ failOn = [] } = {}) {
  const registry = new ConnectionRegistry([
    ConnectionProfile.fromEnvironment("primary", target("app")),
    ConnectionProfile.fromEnvironment("secondary", target("analytics")),
  ]);
  registry.selectInitial("primary");

  const pools = new FakePoolManager({ failOn });
  return { registry, pools, manager: new ConnectionManager(registry, pools) };
}

describe("useDatabase", () => {
  test("moves the active database", async () => {
    const { manager } = build();
    await manager.useDatabase("reporting");
    assert.equal(manager.getActiveTarget().database, "reporting");
  });

  test("verifies before committing", async () => {
    const { manager, pools } = build();
    await manager.useDatabase("reporting");
    assert.deepEqual(pools.verified, ["reader@db:3306/reporting"]);
  });

  test("a failed verification leaves the previous connection active", async () => {
    const { manager } = build({ failOn: ["missing"] });
    await assert.rejects(() => manager.useDatabase("missing"), /Unknown database/);
    assert.equal(manager.getActiveTarget().database, "app");
  });

  test("keeps the profile label, since the connection is still that profile", async () => {
    const { manager } = build();
    await manager.useDatabase("reporting");
    assert.equal(manager.getActiveName(), "primary");
  });

  test("does not rewrite the profile it moved away from", async () => {
    const { manager, registry } = build();
    await manager.useDatabase("reporting");
    assert.equal(registry.find("primary").target.database, "app");
  });
});

describe("useProfile", () => {
  test("switches to the named profile", async () => {
    const { manager } = build();
    await manager.useProfile("secondary");
    assert.equal(manager.getActiveTarget().database, "analytics");
    assert.equal(manager.getActiveName(), "secondary");
  });

  test("applies a database override", async () => {
    const { manager } = build();
    await manager.useProfile("secondary", "other");
    assert.equal(manager.getActiveTarget().database, "other");
  });

  test("an override does not mutate the stored profile", async () => {
    const { manager, registry } = build();
    await manager.useProfile("secondary", "other");
    assert.equal(registry.find("secondary").target.database, "analytics");
  });

  test("an unknown profile throws before any network work", async () => {
    const { manager, pools } = build();
    await assert.rejects(() => manager.useProfile("ghost"), /Unknown profile/);
    assert.deepEqual(pools.verified, [], "must not attempt to verify an unknown profile");
  });

  test("the error lists the known profiles", async () => {
    const { manager } = build();
    await assert.rejects(() => manager.useProfile("ghost"), /primary, secondary/);
  });

  test("a failed verification leaves the previous connection active", async () => {
    const { manager } = build({ failOn: ["analytics"] });
    await assert.rejects(() => manager.useProfile("secondary"));
    assert.equal(manager.getActiveName(), "primary");
  });
});

describe("connect", () => {
  test("activates the target and registers the alias", async () => {
    const { manager, registry } = build();
    await manager.connect(target("adhoc_db"), "adhoc");

    assert.equal(manager.getActiveName(), "adhoc");
    assert.equal(manager.getActiveTarget().database, "adhoc_db");
    assert.equal(registry.find("adhoc").origin, "session");
  });

  test("the alias can be returned to later", async () => {
    const { manager } = build();
    await manager.connect(target("adhoc_db"), "adhoc");
    await manager.useProfile("primary");
    await manager.useProfile("adhoc");
    assert.equal(manager.getActiveTarget().database, "adhoc_db");
  });

  test("a failed connection registers nothing", async () => {
    const { manager, registry } = build({ failOn: ["unreachable"] });
    await assert.rejects(() => manager.connect(target("unreachable"), "adhoc"));

    assert.equal(registry.find("adhoc"), undefined);
    assert.equal(manager.getActiveName(), "primary");
  });
});
