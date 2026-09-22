#!/usr/bin/env node
//
// Propagate the version in package.json to the places that cannot read it.
//
// After PackageVersionLoader, the server reports its version straight from
// package.json, so the only remaining copy is the tag list in the Docker Hub
// description, which is prose and has to be written out.
//
// Run by the `version` npm lifecycle script, so `npm version patch` bumps,
// syncs and stages in one step. Pass --check to verify without writing, which
// is what CI uses to catch a hand-edited version.
//
// Usage: node scripts/sync-version.mjs [--check]

import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const DESCRIPTION_FILE = new URL("README.dockerhub.md", ROOT);

// The published rolling tags, e.g. `1.2.3`, `1.2`, `1`, `latest`. Matched as a
// whole so a restructured section fails loudly instead of silently not
// matching, which would leave a stale version behind with a green exit code.
const TAG_LINE = /^`\d+\.\d+\.\d+`, `\d+\.\d+`, `\d+`, `latest`/m;

const check = process.argv.includes("--check");

const version = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8")).version;
const [major, minor] = version.split(".");
const replacement = `\`${version}\`, \`${major}.${minor}\`, \`${major}\`, \`latest\``;

const original = readFileSync(DESCRIPTION_FILE, "utf8");

if (!TAG_LINE.test(original)) {
  console.error(
    `Could not find the supported tags line in README.dockerhub.md. ` +
      `Update ${import.meta.url.split("/").pop()} if that section was restructured.`
  );
  process.exit(1);
}

const updated = original.replace(TAG_LINE, replacement);

if (updated === original) {
  console.log(`README.dockerhub.md already lists ${version}.`);
  process.exit(0);
}

if (check) {
  console.error(
    `README.dockerhub.md is out of sync with package.json (${version}). ` +
      `Run: node scripts/sync-version.mjs`
  );
  process.exit(1);
}

writeFileSync(DESCRIPTION_FILE, updated);
console.log(`README.dockerhub.md now lists ${version}.`);
