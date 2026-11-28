// Pure assertions for scripts/smoke-pack.mjs. No I/O: each check returns { ok, message }.

const FORBIDDEN = /\.test\.|testsupport|arbitraries|(^|\/)scripts\//;

const pass = (message) => ({ ok: true, message });
const fail = (message) => ({ ok: false, message });

/** The packed file list must be lean and contain the CLI entry. */
export function checkLeanTarball(files) {
  const offending = files.filter((f) => FORBIDDEN.test(f));
  if (offending.length > 0) return fail(`tarball contains forbidden paths: ${offending.join(', ')}`);
  if (!files.includes('dist/cli.js')) return fail('tarball is missing dist/cli.js');
  return pass('tarball is lean and contains dist/cli.js');
}

/** The CLI entry must start with a node shebang on line 1. */
export function checkShebang(cliText) {
  const firstLine = String(cliText).split('\n', 1)[0].replace(/\r$/, '');
  return firstLine === '#!/usr/bin/env node'
    ? pass('dist/cli.js starts with the node shebang')
    : fail(`dist/cli.js line 1 is not "#!/usr/bin/env node" (got ${JSON.stringify(firstLine)})`);
}

/** `ce --version` output must equal the packed package version. */
export function checkVersion(output, expected) {
  const got = String(output).trim();
  return got === expected
    ? pass(`ce --version is ${expected}`)
    : fail(`ce --version printed ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

/** A second `ce init` must exit 1. */
export function checkSecondInitFails(result) {
  return result.code === 1
    ? pass('second init exits 1')
    : fail(`${result.step} must exit 1, got ${result.code}`);
}

/** `ce run` without keys must exit 1, name OPENROUTER_API_KEY and report Outcome: ERROR. */
export function checkKeylessRun(result) {
  const out = String(result.output ?? '');
  if (result.code !== 1) return fail(`${result.step} must exit 1, got ${result.code}`);
  if (!out.includes('OPENROUTER_API_KEY')) return fail(`${result.step} output does not mention OPENROUTER_API_KEY`);
  if (!out.includes('Outcome: ERROR')) return fail(`${result.step} output does not contain "Outcome: ERROR"`);
  return pass('keyless run fails with OPENROUTER_API_KEY and Outcome: ERROR');
}
