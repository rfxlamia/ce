#!/usr/bin/env node
// Builds action/dist/ (task 1.1, packaging spike, Requirement 2.2/2.3/2.8).
//
// Two candidate forms, selected by --form=<name> or CE_ACTION_FORM:
//   bundle   (default) one esbuild file, playwright + playwright-core external,
//            shipped as a pruned action/dist/node_modules/ tree.
//   compiled tsc output plus the pruned production node_modules closure of
//            action/package.json dependencies.
//
// Plain Node script. No build orchestration framework.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const actionDir = join(root, 'action');
// --out-dir=<path> (or CE_ACTION_OUT_DIR) builds somewhere else, for the bundle test.
const outFlag = process.argv.find((a) => a.startsWith('--out-dir='))?.slice('--out-dir='.length);
const outOverride = outFlag ?? process.env.CE_ACTION_OUT_DIR;
const distDir = outOverride ? resolve(outOverride) : join(actionDir, 'dist');
const distModules = join(distDir, 'node_modules');

const FORMS = ['bundle', 'compiled'];
const flag = process.argv.find((a) => a.startsWith('--form='))?.slice('--form='.length);
const form = flag ?? process.env.CE_ACTION_FORM ?? 'bundle';
if (!FORMS.includes(form)) {
  console.error(`build-action: unknown form "${form}". Expected one of: ${FORMS.join(', ')}`);
  process.exit(1);
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Find node_modules/<name> by walking up from `fromDir`. */
function locate(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`build-action: cannot resolve "${name}" from ${fromDir}`);
    dir = parent;
  }
}

/** Production dependency closure (dependencies only; optional deps are skipped). */
function closure(names, fromDir) {
  const found = new Map(); // name -> { dir, version }
  const queue = names.map((n) => ({ name: n, from: fromDir }));
  while (queue.length > 0) {
    const { name, from } = queue.pop();
    const dir = locate(name, from);
    const pkg = readJson(join(dir, 'package.json'));
    const seen = found.get(name);
    if (seen) {
      if (seen.version !== pkg.version) {
        throw new Error(`build-action: version conflict for ${name}: ${seen.version} vs ${pkg.version}`);
      }
      continue;
    }
    found.set(name, { dir, version: pkg.version });
    for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, from: dir });
  }
  return found;
}

// Prune: drop docs, source maps, type declarations and test directories.
// package.json, LICENSE and NOTICE files stay.
const DROP_FILE = /\.(md|markdown|map|d\.ts|d\.mts|d\.cts|tsbuildinfo)$/i;
const DROP_DIR = new Set(['test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github']);
function keep(src) {
  const base = src.split('/').pop() ?? '';
  if (statSync(src).isDirectory()) return !DROP_DIR.has(base);
  return !DROP_FILE.test(base) || base === 'package.json';
}

function copyClosure(names) {
  mkdirSync(distModules, { recursive: true });
  const found = closure(names, root);
  for (const [name, { dir }] of found) {
    cpSync(dir, join(distModules, name), { recursive: true, dereference: true, filter: keep });
  }
  return [...found.keys()].sort();
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

let shipped;
if (form === 'bundle') {
  await build({
    // Two entries: the Action (index.js) and the CE CLI it spawns (ce-cli.js).
    entryPoints: {
      index: join(actionDir, 'src', 'index.ts'),
      'ce-cli': join(root, 'packages', 'ce', 'src', 'cli.ts'),
    },
    outdir: distDir,
    // Module path comments are relative to this directory. Pin it to the repo root so
    // `npm run build` (cwd action/) and `npm run build:action` (cwd root) emit identical bytes.
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['playwright', 'playwright-core'],
    // CommonJS dependencies (yaml, @actions/*) call require() inside the ESM output.
    banner: {
      js: "import { createRequire as __ceCreateRequire } from 'node:module'; const require = __ceCreateRequire(import.meta.url);",
    },
    legalComments: 'none',
    logLevel: 'warning',
  });
  shipped = copyClosure(['playwright', 'playwright-core']);
} else {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const res = spawnSync(process.execPath, [tsc, '-p', join(actionDir, 'tsconfig.json')], {
    stdio: 'inherit',
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
  const deps = Object.keys(readJson(join(actionDir, 'package.json')).dependencies ?? {});
  shipped = copyClosure(deps);
}

console.log(`build-action: form=${form} -> ${distDir}`);
console.log(`build-action: node_modules shipped: ${shipped.join(', ')}`);
