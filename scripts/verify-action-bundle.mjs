#!/usr/bin/env node
// Verifies the packaged action/dist (task 1.2, Requirement 2.2/2.3/2.6/2.10/2.11).
//
// Usage: node scripts/verify-action-bundle.mjs [--form=bundle|compiled] [--image=node:24] [--local]
//
// 1. Builds action/dist with scripts/build-action.mjs --form=<form>.
// 2. Copies the repository tree into a temp dir without any node_modules/
//    (action/dist/node_modules is part of the package and is kept).
// 3. Runs the packaged entry `action/dist/index.js` with Node 24 in a Linux
//    container. The entry exits with the CE CLI exit code (ERROR without a Jev key),
//    so its exit code is not the pass condition. The script passes when the Chromium
//    install succeeded, the entry ran the CLI and wrote its outputs, and a headless
//    Chromium launched through action/dist/node_modules/playwright loads about:blank.
//
// With --local, or when Docker is unavailable, it runs the same entry with the
// local Node and says clearly that the Linux verification was NOT done.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const form = arg('form') ?? 'bundle';
const image = arg('image') ?? 'node:24';
const forceLocal = process.argv.includes('--local');

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const s = dirStats(p);
      bytes += s.bytes;
      files += s.files;
    } else {
      bytes += statSync(p).size;
      files += 1;
    }
  }
  return { bytes, files };
}

// 1. Build.
const build = run(process.execPath, [join(root, 'scripts', 'build-action.mjs'), `--form=${form}`]);
if (build.status !== 0) process.exit(build.status ?? 1);

const dist = dirStats(join(root, 'action', 'dist'));
console.log(
  `verify-action-bundle: form=${form} dist=${(dist.bytes / 1048576).toFixed(1)} MiB, ${dist.files} files`,
);

// 2. Copy the tree without node_modules (except action/dist/node_modules), .git and run output.
const tmp = mkdtempSync(join(tmpdir(), 'ce-action-verify-'));
const distModules = join(root, 'action', 'dist', 'node_modules');
cpSync(root, tmp, {
  recursive: true,
  filter: (src) => {
    const rel = relative(root, src);
    if (rel === '') return true;
    const parts = rel.split(sep);
    if (parts.includes('.git') || parts[0] === '.ce') return false;
    if (parts.includes('node_modules')) {
      return src === distModules || src.startsWith(distModules + sep);
    }
    return true;
  },
});

// Launch check, run with the packaged playwright (not the repository's).
const LAUNCH = `
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/action/dist/');
const { chromium } = req('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.goto('about:blank');
  console.log('verify-action-bundle: chromium loaded ' + p.url());
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
`;
const ENTRY_MARKER = 'verify-action-bundle: entry-done';

let status = 1;
try {
  const docker = forceLocal ? { status: 1 } : spawnSync('docker', ['info'], { stdio: 'ignore' });
  const entryEnv = { GITHUB_OUTPUT: 'outputs.txt', GITHUB_ENV: 'env.txt' };
  const q = (v) => `'${v.replace(/'/g, `'\\''`)}'`;
  if (docker.status === 0) {
    // Playwright's browser dependencies (apt) are preinstalled on GitHub's ubuntu runners.
    // The plain node image lacks them, so install them first, with the packaged playwright-core.
    // The entry installs Chromium itself, then runs the CLI. Its exit code is reported, not required.
    const script = [
      'set -e',
      'node action/dist/node_modules/playwright-core/cli.js install-deps chromium',
      `export GITHUB_OUTPUT=/work/${entryEnv.GITHUB_OUTPUT} GITHUB_ENV=/work/${entryEnv.GITHUB_ENV}; : > $GITHUB_OUTPUT; : > $GITHUB_ENV`,
      'set +e',
      'node action/dist/index.js; code=$?',
      'set -e',
      `echo "${ENTRY_MARKER} exit=$code"`,
      'grep -q "^exit-code" "$GITHUB_OUTPUT" || { echo "verify-action-bundle: entry wrote no exit-code output"; exit 1; }',
      `node -e ${q(LAUNCH)}`,
    ].join('\n');
    console.log(`verify-action-bundle: running in Docker image ${image} (Linux, Node 24)`);
    const res = run('docker', [
      'run', '--rm', '-v', `${tmp}:/work`, '-w', '/work', image, 'sh', '-c', script,
    ]);
    status = res.status ?? 1;
    console.log(`verify-action-bundle: LINUX verification ${status === 0 ? 'PASSED' : 'FAILED'} (form=${form})`);
  } else {
    console.warn('verify-action-bundle: Docker is not available. Running locally.');
    console.warn(`verify-action-bundle: LINUX VERIFICATION NOT DONE. Local platform: ${process.platform}, Node ${process.version}`);
    const env = {
      ...process.env,
      GITHUB_OUTPUT: join(tmp, entryEnv.GITHUB_OUTPUT),
      GITHUB_ENV: join(tmp, entryEnv.GITHUB_ENV),
    };
    writeFileSync(env.GITHUB_OUTPUT, '');
    writeFileSync(env.GITHUB_ENV, '');
    const entry = run(process.execPath, [join(tmp, 'action', 'dist', 'index.js')], { cwd: tmp, env });
    console.log(`${ENTRY_MARKER} exit=${entry.status}`);
    const outputs = readFileSync(env.GITHUB_OUTPUT, 'utf8');
    if (entry.status === null || !/^exit-code/m.test(outputs)) {
      console.error('verify-action-bundle: entry wrote no exit-code output');
      status = 1;
    } else {
      status = run(process.execPath, ['-e', LAUNCH], { cwd: tmp }).status ?? 1;
    }
    console.log(`verify-action-bundle: local run ${status === 0 ? 'passed' : 'failed'} (not a Linux verification)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(status);
