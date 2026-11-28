#!/usr/bin/env node
// Release tag guard (issue #13): checks that a git tag matches the package version
// and prints the npm dist-tag to publish under. Never publishes anything.
//
//   node scripts/release-tag.mjs <tag> [--package <path/to/package.json>]
//
// stdout: "latest" (stable) or "next" (prerelease). Exit 1 on any mismatch.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`release-tag: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
let pkgPath = resolve(root, 'packages/ce/package.json');
let tag;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--package') {
    if (!args[i + 1]) fail('--package requires a path');
    pkgPath = resolve(args[++i]);
  } else if (tag === undefined) {
    tag = args[i];
  } else {
    fail(`unexpected argument: ${args[i]}`);
  }
}
if (!tag) fail('usage: release-tag.mjs <tag> [--package <path>]');

let version;
try {
  version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
} catch (err) {
  fail(`could not read version from ${pkgPath}: ${err.message}`);
}
if (typeof version !== 'string' || version === '') fail(`no version in ${pkgPath}`);

if (tag !== `v${version}`) {
  fail(`tag "${tag}" does not match package version "${version}" (expected "v${version}")`);
}

console.log(version.includes('-') ? 'next' : 'latest');
