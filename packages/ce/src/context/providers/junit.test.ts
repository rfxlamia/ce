import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_JUNIT_BYTES, resolveJunit, type JunitProviderInput } from './junit.js';

const CWD = '/repo';

interface FakeFile {
  text?: string;
  size?: number;
  symlink?: boolean;
  throwOnRead?: boolean;
  unreadable?: boolean;
}

function makeInput(files: Record<string, FakeFile>, checksPattern?: string) {
  const reads: string[] = [];
  const abs = (rel: string) => `${CWD}/${rel}`;
  const input: JunitProviderInput = {
    cwd: CWD,
    ...(checksPattern === undefined ? {} : { checksPattern }),
    listFiles: () => Object.keys(files).map(abs),
    lstat: (p) => {
      const f = files[p.slice(CWD.length + 1)];
      return f ? { isSymbolicLink: () => f.symlink === true } : undefined;
    },
    readFile: (p) => {
      reads.push(p);
      const f = files[p.slice(CWD.length + 1)];
      if (!f || f.unreadable) return undefined;
      if (f.throwOnRead) throw new Error('EIO /secret');
      const text = f.text ?? '';
      return { size: f.size ?? Buffer.byteLength(text), text: () => text };
    },
  };
  return { input, reads };
}

const SUITE = `<?xml version="1.0"?>
<testsuites>
  <testsuite name="s">
    <testcase classname="a.B" name="passes"/>
    <testcase classname="a.B" name="fails"><failure message="x">boom</failure></testcase>
    <testcase name="errors"><error/></testcase>
    <testcase name="skips"><skipped/></testcase>
  </testsuite>
</testsuites>`;

describe('resolveJunit: used', () => {
  it('maps testcases to Check_Results in document order', () => {
    const { input } = makeInput({ 'r/a.xml': { text: SUITE } }, 'r/a.xml');
    const r = resolveJunit(input);
    expect(r.status).toEqual({ name: 'junit', status: 'used' });
    expect(r.checks.map((c) => [c.name, c.status])).toEqual([
      ['a.B.passes', 'passed'],
      ['a.B.fails', 'failed'],
      ['errors', 'failed'],
      ['skips', 'skipped'],
    ]);
    expect(r.checks[0]?.provenance).toEqual({ provider: 'junit', location: 'r/a.xml' });
  });

  it('orders glob matches by ascending path, and `*` does not cross `/`', () => {
    const one = (n: string) => `<testsuite><testcase name="${n}"/></testsuite>`;
    const { input } = makeInput(
      {
        'r/b.xml': { text: one('b') },
        'r/a.xml': { text: one('a') },
        'r/deep/c.xml': { text: one('c') },
        'r/notes.txt': { text: one('t') },
      },
      'r/*.xml',
    );
    expect(resolveJunit(input).checks.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('uses the other files when one file is malformed', () => {
    const { input } = makeInput(
      { 'r/a.xml': { text: '<testsuite><oops' }, 'r/b.xml': { text: SUITE } },
      'r/*.xml',
    );
    const r = resolveJunit(input);
    expect(r.status.status).toBe('used');
    expect(r.checks).toHaveLength(4);
  });

  it('is used with zero checks for a valid file without testcases', () => {
    const { input } = makeInput({ 'r/a.xml': { text: '<testsuite/>' } }, 'r/a.xml');
    const r = resolveJunit(input);
    expect(r.status.status).toBe('used');
    expect(r.checks).toEqual([]);
  });
});

describe('resolveJunit: unavailable Reason_Codes', () => {
  it.each([undefined, ''])('not-configured for %j', (p) => {
    const { input, reads } = makeInput({}, p);
    expect(resolveJunit(input).status).toEqual({ name: 'junit', status: 'unavailable', reason: 'not-configured' });
    expect(reads).toEqual([]);
  });

  it('source-absent for a literal path that does not exist', () => {
    const { input } = makeInput({}, 'r/missing.xml');
    expect(resolveJunit(input).status.reason).toBe('source-absent');
  });

  it('source-absent for a glob matching no file', () => {
    const { input } = makeInput({ 'r/a.txt': { text: 'x' } }, 'r/*.xml');
    const r = resolveJunit(input);
    expect(r.status).toEqual({ name: 'junit', status: 'unavailable', reason: 'source-absent' });
    expect(r.checks).toEqual([]);
  });

  it('source-malformed for invalid XML', () => {
    const { input } = makeInput({ 'r/a.xml': { text: '<a><b></a>' } }, 'r/a.xml');
    expect(resolveJunit(input).status.reason).toBe('source-malformed');
  });

  it('source-unreadable when readFile returns undefined', () => {
    const { input } = makeInput({ 'r/a.xml': { unreadable: true } }, 'r/a.xml');
    expect(resolveJunit(input).status.reason).toBe('source-unreadable');
  });

  it('source-unreadable when readFile throws, without leaking the message', () => {
    const { input } = makeInput({ 'r/a.xml': { throwOnRead: true } }, 'r/a.xml');
    const r = resolveJunit(input);
    expect(r.status.reason).toBe('source-unreadable');
    expect(JSON.stringify(r)).not.toContain('secret');
  });

  it.each(['/etc/junit.xml', '/repo/r/a.xml', 'C:\\r\\a.xml', '../a.xml', 'r/../../a.xml', 'r/../a.xml', '/abs/*.xml'])(
    'source-malformed for unsafe pattern %s, with no file access',
    (p) => {
      const { input, reads } = makeInput({ 'r/a.xml': { text: SUITE } }, p);
      expect(resolveJunit(input).status.reason).toBe('source-malformed');
      expect(reads).toEqual([]);
    },
  );

  it('source-malformed for a symlink and does not read it', () => {
    const { input, reads } = makeInput({ 'r/a.xml': { text: SUITE, symlink: true } }, 'r/a.xml');
    expect(resolveJunit(input).status.reason).toBe('source-malformed');
    expect(reads).toEqual([]);
  });

  it('skips a symlink matched by a glob and uses the regular file', () => {
    const { input } = makeInput(
      { 'r/a.xml': { text: SUITE, symlink: true }, 'r/b.xml': { text: SUITE } },
      'r/*.xml',
    );
    const r = resolveJunit(input);
    expect(r.status.status).toBe('used');
    expect(r.checks.every((c) => c.provenance.location === 'r/b.xml')).toBe(true);
  });

  it('source-malformed for a file over 10 MiB, without parsing it', () => {
    const { input } = makeInput({ 'r/a.xml': { text: SUITE, size: MAX_JUNIT_BYTES + 1 } }, 'r/a.xml');
    expect(resolveJunit(input).status.reason).toBe('source-malformed');
  });

  it('accepts a file of exactly 10 MiB', () => {
    const { input } = makeInput({ 'r/a.xml': { text: SUITE, size: MAX_JUNIT_BYTES } }, 'r/a.xml');
    expect(resolveJunit(input).status.status).toBe('used');
  });

  it('reports the first failing file code when none parses', () => {
    const { input } = makeInput(
      { 'r/a.xml': { unreadable: true }, 'r/b.xml': { text: '<x' } },
      'r/*.xml',
    );
    expect(resolveJunit(input).status.reason).toBe('source-unreadable');
  });
});

describe('resolveJunit: external entity (DTD)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const XXE = (target: string) => `<?xml version="1.0"?>
<!DOCTYPE testsuite [
  <!ENTITY xxe SYSTEM "file://${target}">
]>
<testsuite><testcase name="&xxe;"/></testsuite>`;

  it('never reads the referenced file (injected reader sees only the report)', () => {
    const { input, reads } = makeInput({ 'r/a.xml': { text: XXE('/etc/passwd') } }, 'r/a.xml');
    const r = resolveJunit(input);
    expect(reads).toEqual(['/repo/r/a.xml']);
    expect(JSON.stringify(r)).not.toContain('root:');
  });

  it('does not expand the entity with real files on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ce-junit-'));
    dirs.push(dir);
    const secretPath = join(dir, 'secret.txt');
    writeFileSync(secretPath, 'TOP-SECRET-CONTENT');
    mkdirSync(join(dir, 'r'));
    writeFileSync(join(dir, 'r', 'a.xml'), XXE(secretPath));
    const reads: string[] = [];
    const r = resolveJunit({
      cwd: dir,
      checksPattern: 'r/a.xml',
      listFiles: () => [],
      lstat: () => ({ isSymbolicLink: () => false }),
      readFile: (p) => {
        reads.push(p);
        const buf = readFileSync(p);
        return { size: buf.length, text: () => buf.toString('utf8') };
      },
    });
    expect(reads).toEqual([join(dir, 'r', 'a.xml')]);
    expect(JSON.stringify(r)).not.toContain('TOP-SECRET-CONTENT');
    // Either rejected as malformed or parsed with the entity left unexpanded.
    if (r.status.status === 'unavailable') expect(r.status.reason).toBe('source-malformed');
  });

  it('real symlink is detected by the injected lstat contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ce-junit-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'real.xml'), SUITE);
    symlinkSync(join(dir, 'real.xml'), join(dir, 'link.xml'));
    expect(lstatSync(join(dir, 'link.xml')).isSymbolicLink()).toBe(true);
  });
});
