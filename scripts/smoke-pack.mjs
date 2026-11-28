#!/usr/bin/env node
// Tarball smoke test (issue #13): packs continuous-evidence and proves the tarball
// onboards a fresh repo. Plain Node ESM, no deps. Never publishes anything.
//
//   node scripts/smoke-pack.mjs [--keep]
//
// SMOKE_PACK_BREAK=shebang is a test-only switch that corrupts the extracted
// cli.js copy before the shebang check, to prove the check can fail.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkKeylessRun,
  checkLeanTarball,
  checkSecondInitFails,
  checkShebang,
  checkVersion,
} from './smoke-pack-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const tmp = mkdtempSync(join(tmpdir(), 'ce-smoke-'));

function cleanup() {
  if (keep) console.log(`kept temp dir: ${tmp}`);
  else rmSync(tmp, { recursive: true, force: true });
}

function fail(step, message) {
  console.error(`SMOKE FAIL [${step}]: ${message}`);
  cleanup();
  process.exit(1);
}

function childEnv() {
  const env = { ...process.env };
  delete env.OPENROUTER_API_KEY;
  delete env.TYPESAFE_API_KEY;
  return env;
}

/** Runs argv without a shell; never throws on non-zero exit. */
function run(step, cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env: childEnv(), encoding: 'utf8' });
  if (r.error) fail(step, `could not spawn ${cmd}: ${r.error.message}`);
  return { step, code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '' };
}

function must(step, cmd, args, cwd) {
  const r = run(step, cmd, args, cwd);
  if (r.code !== 0) fail(step, `${cmd} ${args.join(' ')} exited ${r.code}\n${r.output}`);
  return r;
}

function expectCheck(step, check) {
  if (!check.ok) fail(step, check.message);
  console.log(`ok  ${step}: ${check.message}`);
}

// a. pack
const packDir = join(tmp, 'pack');
mkdirSync(packDir);
const pack = must(
  'pack',
  'npm',
  ['pack', '--workspace', 'continuous-evidence', '--pack-destination', packDir, '--json'],
  root,
);
let entry;
try {
  const jsonStart = pack.stdout.indexOf('[');
  [entry] = JSON.parse(pack.stdout.slice(jsonStart));
} catch {
  fail('pack', `could not parse npm pack --json output:\n${pack.output}`);
}
const tgz = join(packDir, entry.filename);
expectCheck('lean tarball', checkLeanTarball(entry.files.map((f) => f.path)));

const extractDir = join(tmp, 'extract');
mkdirSync(extractDir);
must('extract', 'tar', ['-xzf', tgz, '-C', extractDir, 'package/dist/cli.js'], root);
const cliPath = join(extractDir, 'package', 'dist', 'cli.js');
if (process.env.SMOKE_PACK_BREAK === 'shebang') {
  writeFileSync(cliPath, `// broken\n${readFileSync(cliPath, 'utf8')}`);
}
expectCheck('shebang', checkShebang(readFileSync(cliPath, 'utf8')));

// b-f are timed
const started = Date.now();

// b. fresh app
const app = join(tmp, 'app');
mkdirSync(app);
must('git init', 'git', ['init', '-q'], app);
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify({ name: 'smoke-app', private: true, scripts: { dev: 'vite' } }),
);
must('install tarball', 'npm', ['i', '-D', tgz, '--no-audit', '--no-fund'], app);

// c. version. --no-install guarantees we never fetch the unrelated registry `ce` package.
const ce = (step, args) => run(step, 'npx', ['--no-install', 'ce', ...args], app);
const version = ce('ce --version', ['--version']);
if (version.code !== 0) fail('ce --version', `exited ${version.code}\n${version.output}`);
expectCheck('ce --version', checkVersion(version.stdout, entry.version));

// d. init + loadConfig
const init = ce('first init', ['init']);
if (init.code !== 0) fail('first init', `exited ${init.code}\n${init.output}`);
const load = run(
  'loadConfig',
  process.execPath,
  [
    '--input-type=module',
    '-e',
    "import {loadConfig} from 'continuous-evidence'; const r = loadConfig({cwd: process.cwd(), flags: {}, env: {}}); process.exit(r.ok ? 0 : 1)",
  ],
  app,
);
if (load.code !== 0) fail('loadConfig', `loadConfig did not return ok (exit ${load.code})\n${load.output}`);
console.log('ok  first init + loadConfig');

// e. second init
expectCheck('second init', checkSecondInitFails(ce('second init', ['init'])));

// f. keyless run
expectCheck('keyless run', checkKeylessRun(ce('keyless run', ['run'])));

// g.
console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
cleanup();
console.log('SMOKE OK');
