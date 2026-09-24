# CLAUDE.md

Guidance for Claude Code working in this repository.

This is a standalone project, not part of the KP Dashboard product. The monorepo conventions in the parent `CLAUDE.md` about Laravel, Vue and the Action Center do not apply here. The general working rules, such as commit message style and never pushing, do.

## What this is

A read-only MySQL MCP server whose connection can be changed mid-conversation without restarting the client. TypeScript, ESM, Node 22, no framework. Distributed three ways from one codebase: an npm package, a Docker image, and a listing on the MCP Registry.

Deep documentation lives in `docs/wiki/`, which explains why each class is shaped the way it is. Read `docs/wiki/Architecture.md` before changing structure, and `docs/wiki/Read-Only-Enforcement.md` before touching anything in `src/validation/` or `src/database/`.

## Environment

Node 22 is required. The shell here defaults to Herd's Node 16, which breaks the build, so start with:

```bash
export NVM_DIR="$HOME/Library/Application Support/Herd/config/nvm"
. "$NVM_DIR/nvm.sh" && nvm use 22
```

## Commands

```bash
npm run build            # tsc to dist/
npm run typecheck        # tsc --noEmit
npm test                 # build, then every test
npm run test:unit        # unit tests only
npm run test:integration # integration tests, needs a MySQL on 127.0.0.1
npm run sync-version     # propagate package.json version to the files that cannot read it
./scripts/test-in-docker.sh  # full suite against a throwaway MySQL container
```

Tests are `node:test`, no framework. Unit tests mirror `src/` under `test/unit/`. The integration suite skips itself when MySQL is unreachable, which is why CI asserts it actually ran rather than trusting a green tick.

## Invariants

These are the things the project exists to guarantee. Do not weaken them to make something else easier.

- **Read-only, in two independent layers.** `ReadOnlyQueryValidator` rejects anything but `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `DESC` and `EXPLAIN` before a connection is touched, and `SessionInitializer` opens every pooled connection with `SET SESSION TRANSACTION READ ONLY`. The layers are independent on purpose: a parser bug alone must not become a write. Never add a tool that writes.
- **Credentials never reach output.** `ConnectionTarget.key()` excludes the password by construction, and that same string is what gets logged and displayed. Keep identity and display as one string so they cannot drift apart.
- **Nothing is written to disk and nothing is sent anywhere but MySQL.** No telemetry, no analytics, no update check. `PRIVACY.md` states this publicly, so a change here makes that document false.
- **stdout carries JSON-RPC only.** Every diagnostic goes through the injected logger to stderr. One stray `console.log` corrupts the protocol.

## Adding a tool

One class per tool, in its own file named after the class, holding its name, description, input schema and implementation together. Extend `BaseTool`, or `DatabaseScopedTool` when the tool accepts the per-call `database` override, and register it in `ApplicationFactory`.

- Implement `execute` (or `read` for a database-scoped tool). Never override `register` or `invoke`: the base class is what makes the error contract impossible to forget.
- Declare `annotations` in the tool's own class, typed `ToolHints`: a human-readable `title` plus **all four** hints, including the two the specification treats as meaningful only when `readOnlyHint` is false. An omitted hint cannot be told apart from an unconsidered one. There is deliberately no default in `BaseTool`, because directory scanners read each tool's source and report an inherited hint as missing. The type makes an omission a compile error, and CI fails a tool whose handshake lacks a title or any hint.
- The description is written for a model, not a person. State what the tool does and stop. No instructions about unrelated actions, no hidden text, nothing that steers the assistant beyond choosing the right tool. `PRIVACY.md` makes this a public claim.
- Keep the description honest about capability. If it says read, it must not mutate.

## Versioning

`package.json` is the single source of truth. The handshake version is read from it at startup by `PackageVersionLoader`, so **never hardcode a version anywhere**.

Two files carry it as data because they cannot read it: the tag list in `README.dockerhub.md`, and `server.json`, including the tag inside the `oci` identifier. `scripts/sync-version.mjs` owns both, CI runs it with `--check`, and the `version` npm lifecycle runs and stages it.

Bump with:

```bash
npm version patch --no-git-tag-version   # or minor, or major
```

`--no-git-tag-version` matters. Plain `npm version` tags the branch commit, which is not the commit that lands on `master`, so the release would build from a tree `master` never had. Tagging belongs to the GitHub release, after the merge.

## Releasing

Bump on the branch, merge to `master` with CI green, then publish a GitHub release and let it create the tag. Three workflows run from that release: Docker Hub, npm, and the MCP Registry. `docs/wiki/Release-Process.md` is the full description.

- **npm publishes over OIDC trusted publishing.** There is no token, and no `NPM_TOKEN` secret should ever be added; the workflow does not read one.
- **An npm version is immutable.** A bad publish is corrected only by a higher version, which is why the publish workflows re-verify rather than trusting CI.
- **The registry verifies against published artifacts**, not the working tree, so its workflow waits for npm and the image to be live before publishing.
- Add a `CHANGELOG.md` entry for anything user-visible, and say plainly if a version reaches one channel but not another.

## Documentation

- `README.md` and `README.dockerhub.md` carry the same user-facing content. Docker Hub renders neither mermaid nor relative links, so that copy uses ASCII diagrams and absolute URLs. **Change one, change the other.**
- `docs/wiki/` is the source of truth for the GitHub wiki and is mirrored on merge. Edit it here, never in the browser.
- `server.json` must keep naming the same package as `package.json`; CI asserts it, because a rename is only rejected at publish time, after the npm version has become immutable.

## Style

- Comments explain **why**, not what. This codebase is unusually heavily commented and the comments carry the reasoning behind a decision, including what was tried before. Match that.
- Semicolons, trailing commas in multi-line literals, full curly braces on every `if`.
- Never use the em dash character, in code, comments, commits, docs or PR text.
- Prefer a named class with a constructor argument over a module-level singleton, so tests can pass a fake instead of reloading a module.

## Git

- Conventional commit subjects: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `refactor:`. No Jira ticket here; this repo is not part of the KPD board.
- Use the personal git identity, already configured locally on this repository.
- No `Co-Authored-By` lines.
- **Never commit without being asked, and never push.** A task instruction such as "add a changelog" authorizes the change, not the commit.
