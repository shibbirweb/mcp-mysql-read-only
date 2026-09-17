import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpClient } from "../helpers/client.js";
import {
  TEST_DB,
  TEST_DB_ALT,
  connection,
  probe,
  profilesJson,
  seed,
  serverEnv,
  teardown,
} from "../helpers/mysql.js";

const unreachable = await probe();
const suite = unreachable ? describe.skip : describe;

if (unreachable) {
  console.error(`# integration tests skipped, MySQL not reachable: ${unreachable}`);
}

// Fixtures are built once for the whole file and dropped once at the end. Both
// suites below share them, so seeding per suite would pull the databases out
// from under whichever suite ran second.
before(async () => {
  if (!unreachable) {
    await seed();
  }
});

after(async () => {
  if (!unreachable) {
    await teardown();
  }
});

suite("MCP MySQL read-only server", () => {
  let client;

  before(async () => {
    client = new McpClient(serverEnv({ MYSQL_PROFILES: profilesJson() }));
    await client.initialize();
  });

  after(async () => {
    if (client) {
      await client.close();
    }
  });

  describe("handshake", () => {
    test("advertises every tool", async () => {
      const names = (await client.listTools()).map((tool) => tool.name).sort();
      assert.deepEqual(names, [
        "connect",
        "current_connection",
        "describe_table",
        "get_foreign_keys",
        "get_table_indexes",
        "get_table_sample",
        "list_connections",
        "list_databases",
        "list_tables",
        "run_query",
        "use_connection",
        "use_database",
      ]);
    });

    test("every tool has a description", async () => {
      for (const tool of await client.listTools()) {
        assert.ok(tool.description?.length > 0, `${tool.name} has no description`);
      }
    });
  });

  describe("reading", () => {
    test("lists tables in the active database", async () => {
      const { text, isError } = await client.call("list_tables");
      assert.equal(isError, false);
      assert.match(text, /authors/);
      assert.match(text, /books/);
    });

    test("describes a table", async () => {
      const { text } = await client.call("describe_table", { table: "authors" });
      assert.match(text, /"Field": "name"/);
    });

    test("reports indexes", async () => {
      const { text } = await client.call("get_table_indexes", { table: "authors" });
      assert.match(text, /authors_name_unique/);
    });

    test("reports foreign keys", async () => {
      const { text } = await client.call("get_foreign_keys", { table: "books" });
      assert.match(text, /books_author_id_foreign/);
      assert.match(text, /"REFERENCED_TABLE_NAME": "authors"/);
    });

    test("says so plainly when a table has no foreign keys", async () => {
      const { text, isError } = await client.call("get_foreign_keys", { table: "authors" });
      assert.equal(isError, false);
      assert.match(text, /No foreign keys/);
    });

    test("samples rows", async () => {
      const { text } = await client.call("get_table_sample", { table: "books", limit: 1 });
      const rows = JSON.parse(text);
      assert.equal(rows.length, 1);
    });

    test("runs a query", async () => {
      const { text } = await client.call("run_query", {
        query: "SELECT COUNT(*) AS total FROM authors",
      });
      assert.equal(JSON.parse(text)[0].total, 2);
    });

    test("runs a read-only CTE", async () => {
      const { text, isError } = await client.call("run_query", {
        query: "WITH c AS (SELECT id FROM authors) SELECT COUNT(*) AS total FROM c",
      });
      assert.equal(isError, false);
      assert.equal(JSON.parse(text)[0].total, 2);
    });
  });

  describe("switching the connection at runtime", () => {
    test("starts on the configured default", async () => {
      const { text } = await client.call("current_connection");
      assert.match(text, new RegExp(TEST_DB));
    });

    test("use_database moves the active database", async () => {
      const switched = await client.call("use_database", { database: TEST_DB_ALT });
      assert.equal(switched.isError, false);

      const { text } = await client.call("run_query", { query: "SELECT DATABASE() AS db" });
      assert.equal(JSON.parse(text)[0].db, TEST_DB_ALT);
    });

    test("the switch persists across calls", async () => {
      const { text } = await client.call("list_tables");
      assert.match(text, /widgets/);
      assert.ok(!text.includes("authors"));
    });

    test("use_connection moves to another profile", async () => {
      await client.call("use_connection", { profile: "primary" });
      const { text } = await client.call("run_query", { query: "SELECT DATABASE() AS db" });
      assert.equal(JSON.parse(text)[0].db, TEST_DB);
    });

    test("use_connection accepts a database override", async () => {
      await client.call("use_connection", { profile: "primary", database: TEST_DB_ALT });
      const { text } = await client.call("current_connection");
      assert.match(text, new RegExp(TEST_DB_ALT));
      await client.call("use_connection", { profile: "primary" });
    });

    test("connect opens an arbitrary target and remembers the alias", async () => {
      const opened = await client.call("connect", {
        host: connection.host,
        port: connection.port,
        user: connection.user,
        password: connection.password,
        database: TEST_DB_ALT,
        alias: "adhoc",
      });
      assert.equal(opened.isError, false);

      const active = await client.call("run_query", { query: "SELECT DATABASE() AS db" });
      assert.equal(JSON.parse(active.text)[0].db, TEST_DB_ALT);

      const listed = await client.call("list_connections");
      assert.match(listed.text, /adhoc \(session\)/);

      await client.call("use_connection", { profile: "primary" });
    });

    test("list_connections marks the active profile", async () => {
      const { text } = await client.call("list_connections");
      const active = text.split("\n").filter((line) => line.startsWith("* "));
      assert.equal(active.length, 1);
      assert.match(active[0], /primary/);
    });

    test("list_databases hides system schemas by default", async () => {
      const { text } = await client.call("list_databases");
      assert.ok(!text.includes("information_schema"));
      assert.match(text, new RegExp(TEST_DB));
    });

    test("list_databases can include them", async () => {
      const { text } = await client.call("list_databases", { include_system: true });
      assert.match(text, /information_schema/);
    });
  });

  describe("per-call database override", () => {
    test("reads elsewhere without moving the active connection", async () => {
      const before = await client.call("current_connection");

      const elsewhere = await client.call("run_query", {
        query: "SELECT DATABASE() AS db",
        database: TEST_DB_ALT,
      });
      assert.equal(JSON.parse(elsewhere.text)[0].db, TEST_DB_ALT);

      const after = await client.call("current_connection");
      assert.equal(after.text, before.text, "active connection must be unchanged");
    });

    test("works on schema tools too", async () => {
      const { text } = await client.call("list_tables", { database: TEST_DB_ALT });
      assert.match(text, /widgets/);
    });
  });

  describe("the read-only guard rejects writes", () => {
    const blocked = [
      ["insert", "INSERT INTO authors (name) VALUES ('Mallory')"],
      ["update", "UPDATE authors SET name = 'Mallory'"],
      ["delete", "DELETE FROM authors"],
      ["drop", "DROP TABLE authors"],
      ["truncate", "TRUNCATE authors"],
      ["statement stacking", "SELECT 1; DROP TABLE authors"],
      ["write behind a CTE", "WITH c AS (SELECT 1) DELETE FROM authors"],
      ["outfile", "SELECT * FROM authors INTO OUTFILE '/tmp/x'"],
    ];

    for (const [name, query] of blocked) {
      test(`rejects ${name}`, async () => {
        const { isError } = await client.call("run_query", { query });
        assert.equal(isError, true, `expected rejection: ${query}`);
      });
    }

    test("the data is genuinely untouched afterwards", async () => {
      const { text } = await client.call("run_query", {
        query: "SELECT COUNT(*) AS total FROM authors",
      });
      assert.equal(JSON.parse(text)[0].total, 2);
    });

    test("a semicolon inside a literal is still allowed through", async () => {
      const { text, isError } = await client.call("run_query", {
        query: "SELECT 'a;b' AS x",
      });
      assert.equal(isError, false);
      assert.equal(JSON.parse(text)[0].x, "a;b");
    });
  });

  describe("the MySQL session is read-only as a second layer", () => {
    test("transaction_read_only is on", async () => {
      const { text } = await client.call("run_query", {
        query: "SELECT @@session.transaction_read_only AS ro",
      });
      assert.equal(JSON.parse(text)[0].ro, 1);
    });

    test("a statement timeout is set", async () => {
      const { text } = await client.call("run_query", {
        query: "SELECT @@session.max_execution_time AS ms",
      });
      assert.ok(JSON.parse(text)[0].ms > 0);
    });
  });

  describe("identifiers are validated before interpolation", () => {
    const attacks = [
      "authors; DROP TABLE authors",
      "authors`; DROP TABLE authors; --",
      "authors WHERE 1=1",
      "*",
    ];

    for (const table of attacks) {
      test(`rejects ${JSON.stringify(table)}`, async () => {
        const { text, isError } = await client.call("describe_table", { table });
        assert.equal(isError, true);
        assert.match(text, /Invalid table name/);
      });
    }

    test("rejects an injected database name", async () => {
      const { isError } = await client.call("use_database", { database: "x; DROP DATABASE y" });
      assert.equal(isError, true);
    });
  });

  describe("failures are reported without breaking the session", () => {
    test("an unknown database fails the switch", async () => {
      const { text, isError } = await client.call("use_database", { database: "no_such_db" });
      assert.equal(isError, true);
      assert.match(text, /Unknown database/i);
    });

    test("and leaves the previous connection active", async () => {
      const { text } = await client.call("run_query", { query: "SELECT DATABASE() AS db" });
      assert.equal(JSON.parse(text)[0].db, TEST_DB);
    });

    test("an unknown profile lists the known ones", async () => {
      const { text, isError } = await client.call("use_connection", { profile: "ghost" });
      assert.equal(isError, true);
      assert.match(text, /primary/);
    });

    test("a syntax error is returned as a tool error, not a crash", async () => {
      const { isError } = await client.call("run_query", { query: "SELECT FROM WHERE" });
      assert.equal(isError, true);

      const stillAlive = await client.call("run_query", { query: "SELECT 1 AS n" });
      assert.equal(stillAlive.isError, false);
    });
  });

  describe("large result sets", () => {
    test("are truncated with a note rather than dumped whole", async () => {
      const { text } = await client.call("run_query", {
        query: `
          SELECT seq.n
          FROM (
            SELECT a.n + b.n * 10 + c.n * 100 AS n
            FROM (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                  UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a,
                 (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
                  UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) b,
                 (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2) c
          ) seq
        `,
      });
      assert.match(text, /Showing 100 of 300 rows/);
    });
  });
});

suite("a server started with no configuration", () => {
  let bare;

  before(async () => {
    bare = new McpClient({
      MYSQL_PROFILES: "",
      MYSQL_DEFAULT_PROFILE: "",
      MYSQL_HOST: "",
      MYSQL_PORT: "",
      MYSQL_USER: "",
      MYSQL_PASSWORD: "",
      MYSQL_DATABASE: "",
    });
    await bare.initialize();
  });

  after(async () => {
    if (bare) {
      await bare.close();
    }
  });

  // Starting without configuration must not be fatal: connect is the whole
  // point, and a server that refused to boot would look like a crash.
  test("still starts and serves tools", async () => {
    const tools = await bare.listTools();
    assert.ok(tools.length > 0);
  });

  test("says there is no active connection", async () => {
    const { text } = await bare.call("current_connection");
    assert.match(text, /No active connection/);
  });

  test("reads fail with a message pointing at connect", async () => {
    const { text, isError } = await bare.call("list_tables");
    assert.equal(isError, true);
    assert.match(text, /connect/);
  });

  test("connect brings it to life", async () => {
    const opened = await bare.call("connect", {
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      database: TEST_DB,
    });
    assert.equal(opened.isError, false);

    const { text } = await bare.call("run_query", { query: "SELECT DATABASE() AS db" });
    assert.equal(JSON.parse(text)[0].db, TEST_DB);
  });
});
