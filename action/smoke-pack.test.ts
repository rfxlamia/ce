import { describe, expect, it } from 'vitest';
import {
  checkKeylessRun,
  checkLeanTarball,
  checkSecondInitFails,
  checkShebang,
  checkVersion,
} from '../scripts/smoke-pack-checks.mjs';

const GOOD_FILES = ['package.json', 'dist/cli.js', 'dist/index.js', 'dist/runtime/demo-app.js'];

describe('checkLeanTarball', () => {
  it('passes a lean file list', () => {
    expect(checkLeanTarball(GOOD_FILES).ok).toBe(true);
  });

  it.each(['dist/x.test.js', 'dist/runtime/demo-app.testsupport.js', 'dist/evidence/arbitraries.js', 'dist/scripts/a.js'])(
    'fails naming %s',
    (bad) => {
      const r = checkLeanTarball([...GOOD_FILES, bad]);
      expect(r.ok).toBe(false);
      expect(r.message).toContain(bad);
    },
  );

  it('fails when dist/cli.js is missing', () => {
    const r = checkLeanTarball(['package.json', 'dist/index.js']);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('dist/cli.js');
  });
});

describe('checkShebang', () => {
  it('passes with a node shebang on line 1', () => {
    expect(checkShebang('#!/usr/bin/env node\nconsole.log(1);\n').ok).toBe(true);
  });
  it('fails without it on line 1', () => {
    expect(checkShebang('console.log(1);\n#!/usr/bin/env node\n').ok).toBe(false);
    expect(checkShebang('').ok).toBe(false);
  });
});

describe('checkSecondInitFails', () => {
  it('fails when the second init exits 0', () => {
    const r = checkSecondInitFails({ step: 'second init', code: 0 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('second init');
  });
  it('passes when it exits 1', () => {
    expect(checkSecondInitFails({ step: 'second init', code: 1 }).ok).toBe(true);
  });
});

describe('checkKeylessRun', () => {
  const good = { step: 'keyless run', code: 1, output: 'Missing OPENROUTER_API_KEY\nOutcome: ERROR\n' };
  it('passes a keyless failure naming the key', () => {
    expect(checkKeylessRun(good).ok).toBe(true);
  });
  it('fails when output lacks OPENROUTER_API_KEY', () => {
    expect(checkKeylessRun({ ...good, output: 'Outcome: ERROR' }).ok).toBe(false);
  });
  it('fails when output lacks Outcome: ERROR', () => {
    expect(checkKeylessRun({ ...good, output: 'OPENROUTER_API_KEY missing' }).ok).toBe(false);
  });
  it('fails when exit code is 0', () => {
    expect(checkKeylessRun({ ...good, code: 0 }).ok).toBe(false);
  });
});

describe('checkVersion', () => {
  it('passes when equal (trimmed)', () => {
    expect(checkVersion('0.1.0\n', '0.1.0').ok).toBe(true);
  });
  it('fails when different', () => {
    const r = checkVersion('0.0.9', '0.1.0');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('0.1.0');
  });
});
