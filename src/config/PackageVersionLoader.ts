import { readFileSync } from "node:fs";

/**
 * Reads the version clients see in the MCP handshake from `package.json`.
 *
 * It used to be a literal in `McpMySqlServer`, which meant a release had to
 * remember to change the same number in two files. Nothing enforced that, and
 * the tag check in the publish workflows never looked at the literal, so a
 * missed bump shipped a server that misreported itself to every client.
 *
 * `package.json` is present in all three ways this server is distributed: the
 * npm tarball always includes it, the runtime image copies it in before the
 * build output, and a local checkout has it by definition.
 */
export class PackageVersionLoader {
  /**
   * Used when `package.json` cannot be read. A server that starts and reports
   * an obviously wrong version is easier to diagnose than one that refuses to
   * start over metadata it does not need in order to answer queries.
   */
  public static readonly UNKNOWN_VERSION = "0.0.0";

  /**
   * Resolved from this module rather than from `process.cwd()`, so the answer
   * does not depend on the directory the client happened to launch us from.
   */
  constructor(
    private readonly packageJsonUrl: URL = new URL("../../package.json", import.meta.url)
  ) {}

  public load(): string {
    try {
      const contents = readFileSync(this.packageJsonUrl, "utf8");
      const version = JSON.parse(contents).version;
      return typeof version === "string" && version.length > 0
        ? version
        : PackageVersionLoader.UNKNOWN_VERSION;
    } catch {
      return PackageVersionLoader.UNKNOWN_VERSION;
    }
  }
}
