import mysql from "mysql2/promise";

export const TEST_DB = process.env.TEST_MYSQL_DATABASE ?? "mcp_test";
export const TEST_DB_ALT = process.env.TEST_MYSQL_DATABASE_ALT ?? "mcp_test_alt";

export const connection = {
  host: process.env.TEST_MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
  user: process.env.TEST_MYSQL_USER ?? "root",
  password: process.env.TEST_MYSQL_PASSWORD ?? "",
};

/** Env block handed to a server under test, pointing at TEST_DB. */
export function serverEnv(overrides = {}) {
  return {
    MYSQL_HOST: connection.host,
    MYSQL_PORT: String(connection.port),
    MYSQL_USER: connection.user,
    MYSQL_PASSWORD: connection.password,
    MYSQL_DATABASE: TEST_DB,
    ...overrides,
  };
}

/** Profiles JSON covering both fixture databases. */
export function profilesJson() {
  const base = { ...connection };
  return JSON.stringify({
    primary: { ...base, database: TEST_DB },
    secondary: { ...base, database: TEST_DB_ALT },
  });
}

/**
 * Integration tests need a real server. Returns null when one is not reachable
 * so the suite can skip instead of failing on developer machines without MySQL.
 */
export async function probe() {
  try {
    const conn = await mysql.createConnection({ ...connection, connectTimeout: 3000 });
    await conn.query("SELECT 1");
    await conn.end();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Build both fixture databases from scratch. Two are needed because the point
 * of this server is switching between them, which a single database cannot
 * exercise.
 */
export async function seed() {
  const conn = await mysql.createConnection({ ...connection, multipleStatements: true });

  await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB_ALT}\``);
  await conn.query(`CREATE DATABASE \`${TEST_DB}\``);
  await conn.query(`CREATE DATABASE \`${TEST_DB_ALT}\``);

  await conn.query(`
    CREATE TABLE \`${TEST_DB}\`.authors (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY authors_name_unique (name)
    ) ENGINE=InnoDB
  `);

  await conn.query(`
    CREATE TABLE \`${TEST_DB}\`.books (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      author_id INT UNSIGNED NOT NULL,
      title VARCHAR(200) NOT NULL,
      PRIMARY KEY (id),
      KEY books_author_id_index (author_id),
      CONSTRAINT books_author_id_foreign FOREIGN KEY (author_id)
        REFERENCES \`${TEST_DB}\`.authors (id)
    ) ENGINE=InnoDB
  `);

  await conn.query(`INSERT INTO \`${TEST_DB}\`.authors (name) VALUES ('Ursula'), ('Terry')`);
  await conn.query(
    `INSERT INTO \`${TEST_DB}\`.books (author_id, title) VALUES (1, 'A Wizard of Earthsea'), (2, 'Mort')`
  );

  // The second database holds a different table on purpose, so a test can tell
  // which database answered just by the table list.
  await conn.query(`
    CREATE TABLE \`${TEST_DB_ALT}\`.widgets (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      label VARCHAR(50) NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);
  await conn.query(`INSERT INTO \`${TEST_DB_ALT}\`.widgets (label) VALUES ('alpha')`);

  await conn.end();
}

export async function teardown() {
  const conn = await mysql.createConnection(connection);
  await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await conn.query(`DROP DATABASE IF EXISTS \`${TEST_DB_ALT}\``);
  await conn.end();
}
