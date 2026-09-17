import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeQuery, verifyTarget } from "./db.js";
import { validateIdentifier, validateReadOnlyQuery } from "./validation.js";
import {
  ConnectionTarget,
  addSessionProfile,
  describeTarget,
  getActiveName,
  getActiveTarget,
  getProfile,
  listProfiles,
  requireActiveTarget,
  setActiveProfile,
  setActiveTarget,
  withDatabase,
} from "./connections.js";

const MAX_OUTPUT_ROWS = 100;

const SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "performance_schema",
  "mysql",
  "sys",
]);

const databaseParam = z
  .string()
  .optional()
  .describe(
    "Optional database to read from for this call only, without changing the active connection"
  );

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function failure(body: string) {
  return { content: [{ type: "text" as const, text: `Error: ${body}` }], isError: true };
}

function json(rows: unknown) {
  return text(JSON.stringify(rows, null, 2));
}

function formatRows(rows: unknown[]): string {
  const truncated = rows.length > MAX_OUTPUT_ROWS;
  const shown = truncated ? rows.slice(0, MAX_OUTPUT_ROWS) : rows;
  let body = JSON.stringify(shown, null, 2);

  if (truncated) {
    body += `\n\n--- Showing ${MAX_OUTPUT_ROWS} of ${rows.length} rows. Add a LIMIT clause for smaller results. ---`;
  }
  return body;
}

/**
 * Every tool body funnels through here so a dead connection or a rejected
 * write surfaces as a tool error rather than an unhandled rejection.
 */
async function guard(run: () => Promise<ReturnType<typeof text>>) {
  try {
    return await run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure(reason);
  }
}

function checkDatabaseParam(database?: string): string | null {
  if (!database) {
    return null;
  }
  const check = validateIdentifier(database, "database name");
  return check.valid ? null : (check.error ?? "Invalid database name.");
}

export function registerTools(server: McpServer): void {
  server.tool(
    "current_connection",
    "Show which MySQL server and database the read-only tools are currently pointed at",
    {},
    async () =>
      guard(async () => {
        const target = getActiveTarget();
        if (!target) {
          return text("No active connection. Call connect or use_connection to set one.");
        }
        return text(`Active profile: ${getActiveName()}\nTarget: ${describeTarget(target)}`);
      })
  );

  server.tool(
    "list_connections",
    "List the connection profiles available to switch to, including any added during this session",
    {},
    async () =>
      guard(async () => {
        const all = listProfiles();
        if (all.length === 0) {
          return text("No profiles configured. Use connect to open one directly.");
        }

        const activeName = getActiveName();
        const lines = all.map((profile) => {
          const marker = profile.name === activeName ? "* " : "  ";
          return `${marker}${profile.name} (${profile.origin}) -> ${describeTarget(profile.target)}`;
        });

        return text(`Connection profiles:\n${lines.join("\n")}`);
      })
  );

  server.tool(
    "list_databases",
    "List databases on the currently connected MySQL server",
    {
      include_system: z
        .boolean()
        .default(false)
        .describe("Include information_schema, performance_schema, mysql and sys"),
    },
    async ({ include_system: includeSystem }) =>
      guard(async () => {
        const rows = (await executeQuery("SHOW DATABASES")) as Record<string, string>[];
        const names = rows
          .map((row) => Object.values(row)[0])
          .filter((name) => includeSystem || !SYSTEM_SCHEMAS.has(name));
        const active = requireActiveTarget();
        const lines = names.map((name) => (name === active.database ? `* ${name}` : `  ${name}`));

        return text(`Databases (${names.length}):\n${lines.join("\n")}`);
      })
  );

  server.tool(
    "use_database",
    "Switch the active database on the current MySQL server. Takes effect immediately, no restart needed",
    { database: z.string().describe("Database name to switch to") },
    async ({ database }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const active = requireActiveTarget();
        const candidate = withDatabase(active, database);
        await verifyTarget(candidate);
        setActiveTarget(candidate, getActiveName() ?? "custom");

        return text(`Switched to ${describeTarget(candidate)}`);
      })
  );

  server.tool(
    "use_connection",
    "Switch to a named connection profile. Takes effect immediately, no restart needed",
    {
      profile: z.string().describe("Profile name from list_connections"),
      database: z
        .string()
        .optional()
        .describe("Optional database to use instead of the profile's own database"),
    },
    async ({ profile, database }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const found = getProfile(profile);
        if (!found) {
          const known = listProfiles()
            .map((entry) => entry.name)
            .join(", ");
          return failure(`Unknown profile "${profile}". Known profiles: ${known || "none"}`);
        }

        const candidate = database ? withDatabase(found.target, database) : found.target;
        await verifyTarget(candidate);
        setActiveProfile(profile);
        setActiveTarget(candidate, profile);

        return text(`Switched to profile "${profile}" -> ${describeTarget(candidate)}`);
      })
  );

  server.tool(
    "connect",
    "Connect to any MySQL server at runtime with explicit credentials. Not persisted to disk, but kept for the rest of the session under an alias",
    {
      host: z
        .string()
        .default("host.docker.internal")
        .describe("Hostname. Use host.docker.internal for MySQL on this Mac"),
      port: z.number().int().min(1).max(65535).default(3306).describe("Port"),
      user: z.string().describe("MySQL user"),
      password: z.string().default("").describe("MySQL password, empty string if none"),
      database: z.string().describe("Database to open"),
      alias: z
        .string()
        .optional()
        .describe("Name to remember this connection under for use_connection later"),
    },
    async ({ host, port, user, password, database, alias }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const candidate: ConnectionTarget = { host, port, user, password, database };
        await verifyTarget(candidate);

        const profileName = alias ?? "custom";
        addSessionProfile(profileName, candidate);
        setActiveTarget(candidate, profileName);

        return text(`Connected as "${profileName}" -> ${describeTarget(candidate)}`);
      })
  );

  server.tool(
    "list_tables",
    "List all tables in the active database",
    { database: databaseParam },
    async ({ database }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const rows = (await executeQuery("SHOW TABLES", undefined, database)) as Record<
          string,
          string
        >[];
        const tables = rows.map((row) => Object.values(row)[0]);

        return text(`Tables (${tables.length}):\n${tables.join("\n")}`);
      })
  );

  server.tool(
    "describe_table",
    "Show columns and schema for a specific table",
    { table: z.string().describe("Table name"), database: databaseParam },
    async ({ table, database }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const check = validateIdentifier(table, "table name");
        if (!check.valid) {
          return failure(check.error ?? "Invalid table name.");
        }

        const rows = await executeQuery(`SHOW COLUMNS FROM \`${table}\``, undefined, database);
        return json(rows);
      })
  );

  server.tool(
    "get_table_indexes",
    "Show indexes for a specific table",
    { table: z.string().describe("Table name"), database: databaseParam },
    async ({ table, database }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const check = validateIdentifier(table, "table name");
        if (!check.valid) {
          return failure(check.error ?? "Invalid table name.");
        }

        const rows = await executeQuery(`SHOW INDEX FROM \`${table}\``, undefined, database);
        return json(rows);
      })
  );

  server.tool(
    "get_foreign_keys",
    "Show foreign key relationships for a specific table",
    { table: z.string().describe("Table name"), database: databaseParam },
    async ({ table, database }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const check = validateIdentifier(table, "table name");
        if (!check.valid) {
          return failure(check.error ?? "Invalid table name.");
        }

        const rows = (await executeQuery(
          `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME
           FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
          [table],
          database
        )) as unknown[];

        if (rows.length === 0) {
          return text(`No foreign keys found for table "${table}".`);
        }
        return json(rows);
      })
  );

  server.tool(
    "get_table_sample",
    "Get sample rows from a table",
    {
      table: z.string().describe("Table name"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(5)
        .describe("Number of rows to return (1-50, default 5)"),
      database: databaseParam,
    },
    async ({ table, limit, database }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const check = validateIdentifier(table, "table name");
        if (!check.valid) {
          return failure(check.error ?? "Invalid table name.");
        }

        const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
        const rows = await executeQuery(
          `SELECT * FROM \`${table}\` LIMIT ${safeLimit}`,
          undefined,
          database
        );
        return json(rows);
      })
  );

  server.tool(
    "run_query",
    "Execute a read-only SQL query (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN only) against the active connection",
    { query: z.string().describe("SQL query to execute"), database: databaseParam },
    async ({ query, database }) =>
      guard(async () => {
        const invalid = checkDatabaseParam(database);
        if (invalid) {
          return failure(invalid);
        }

        const check = validateReadOnlyQuery(query);
        if (!check.valid) {
          return failure(check.error ?? "Query rejected.");
        }

        const rows = (await executeQuery(query, undefined, database)) as unknown[];
        return text(formatRows(rows));
      })
  );
}
