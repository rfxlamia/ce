import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatFileError } from './errors.js';
import { discoverConfigFile, readAndParseConfigFile } from './file.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-file-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('discoverConfigFile (Requirements 4.1-4.5, 4.12-4.16)', () => {
  it('finds only ce.yml', () => {
    const p = write('ce.yml', 'version: 0\n');
    expect(discoverConfigFile({ cwd: dir })).toEqual({ path: p, ignoredPath: null });
  });

  it('finds only .ce.yml', () => {
    const p = write('.ce.yml', 'version: 0\n');
    expect(discoverConfigFile({ cwd: dir })).toEqual({ path: p, ignoredPath: null });
  });

  it('prefers ce.yml and records .ce.yml as ignored when both exist', () => {
    const p = write('ce.yml', 'version: 0\n');
    const hidden = write('.ce.yml', 'version: 0\n');
    expect(discoverConfigFile({ cwd: dir })).toEqual({ path: p, ignoredPath: hidden });
  });

  it('returns no file when neither exists', () => {
    expect(discoverConfigFile({ cwd: dir })).toEqual({ path: null, ignoredPath: null });
  });

  it('does not look in parent directories', () => {
    write('ce.yml', 'version: 0\n');
    const child = path.join(dir, 'child');
    fs.mkdirSync(child);
    expect(discoverConfigFile({ cwd: child })).toEqual({ path: null, ignoredPath: null });
  });

  it('uses --config and neither reads nor records ce.yml', () => {
    write('ce.yml', 'version: 0\n');
    write('.ce.yml', 'version: 0\n');
    const other = write('other.yml', 'version: 0\n');
    expect(discoverConfigFile({ cwd: dir, configFlag: other })).toEqual({
      path: other,
      ignoredPath: null,
    });
  });

  it('rejects a missing --config file with the path as given, without falling back to ce.yml', () => {
    write('ce.yml', 'version: 0\n');
    const result = discoverConfigFile({ cwd: dir, configFlag: 'nope/missing.yml' });
    expect(result).toMatchObject({
      flagError: { path: 'config', source: 'flag', value: 'nope/missing.yml' },
    });
    const err = (result as { flagError: { expected: string } }).flagError;
    expect(err.expected).toContain('nope/missing.yml');
    expect('path' in result && result.path).toBeFalsy();
  });

  it('resolves a relative --config against the cwd parameter, not process.cwd()', () => {
    const p = write('rel.yml', 'version: 0\n');
    expect(path.resolve(process.cwd())).not.toBe(path.resolve(dir));
    expect(discoverConfigFile({ cwd: dir, configFlag: 'rel.yml' })).toEqual({
      path: p,
      ignoredPath: null,
    });
  });

  it.each(['', '   ', '\t\n'])('rejects empty or whitespace --config %j', (flag) => {
    write('ce.yml', 'version: 0\n');
    const result = discoverConfigFile({ cwd: dir, configFlag: flag });
    expect(result).toMatchObject({ flagError: { path: 'config', source: 'flag', value: flag } });
  });
});

describe('readAndParseConfigFile (Requirements 4.6-4.11, 6.9, 6.19, 6.20, 9.16)', () => {
  it('returns an empty mapping when there is no file', () => {
    expect(readAndParseConfigFile(null)).toEqual({ ok: true, value: {} });
  });

  it('treats an empty file as an empty mapping', () => {
    expect(readAndParseConfigFile(write('ce.yml', ''))).toEqual({ ok: true, value: {} });
  });

  it('treats a comments-only file as an empty mapping', () => {
    expect(readAndParseConfigFile(write('ce.yml', '# just a comment\n# another\n'))).toEqual({
      ok: true,
      value: {},
    });
  });

  it('parses a valid mapping', () => {
    expect(readAndParseConfigFile(write('ce.yml', 'version: 0\nruntime:\n  max-steps: 5\n'))).toEqual({
      ok: true,
      value: { version: 0, runtime: { 'max-steps': 5 } },
    });
  });

  it('reports malformed YAML as a parse ConfigFileError', () => {
    const file = write('ce.yml', 'runtime: [1, 2\nother: 3\n');
    const result = readAndParseConfigFile(file);
    expect(result.ok).toBe(false);
    expect('errors' in result).toBe(false);
    const fileError = (result as unknown as { fileError: Record<string, unknown> }).fileError;
    expect(fileError.kind).toBe('parse');
    expect(fileError.file).toContain('ce.yml');
    expect(typeof fileError.code === 'string' && fileError.code.length > 0).toBe(true);
    expect(typeof fileError.message === 'string' && fileError.message.length > 0).toBe(true);
    expect(typeof fileError.line).toBe('number');
    expect(typeof fileError.column).toBe('number');
    expect('path' in fileError).toBe(false);
    expect('value' in fileError).toBe(false);
    expect('expected' in fileError).toBe(false);

    const printed = formatFileError(fileError as never);
    expect(printed).toContain('ce.yml');
    expect(printed).toContain(String(fileError.code));
  });

  it('reports a scalar root as a (root) ValidationError', () => {
    const result = readAndParseConfigFile(write('ce.yml', 'just text\n'));
    expect(result).toEqual({
      ok: false,
      errors: [{ path: '(root)', value: 'just text', expected: 'mapping', source: 'file' }],
    });
  });

  it('reports an array root as a (root) ValidationError', () => {
    const result = readAndParseConfigFile(write('ce.yml', '- a\n- b\n'));
    expect(result).toEqual({
      ok: false,
      errors: [{ path: '(root)', value: ['a', 'b'], expected: 'mapping', source: 'file' }],
    });
  });

  it('does not execute a YAML custom tag', () => {
    const result = readAndParseConfigFile(
      write('ce.yml', 'target:\n  start: !!js/function "function () { throw new Error(1) }"\n'),
    );
    expect(result.ok).toBe(true);
    const value = (result as { value: { target: { start: unknown } } }).value;
    expect(typeof value.target.start).not.toBe('function');
  });

  it('reports an unreadable file as a read ConfigFileError', (ctx) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) ctx.skip();
    const file = write('ce.yml', 'version: 0\n');
    fs.chmodSync(file, 0o000);
    try {
      const result = readAndParseConfigFile(file);
      expect(result.ok).toBe(false);
      expect('errors' in result).toBe(false);
      const fileError = (result as unknown as { fileError: Record<string, unknown> }).fileError;
      expect(fileError.kind).toBe('read');
      expect(fileError.file).toContain('ce.yml');
      expect(fileError.code).toBe('EACCES');
      expect('path' in fileError).toBe(false);
      expect('value' in fileError).toBe(false);
      expect('expected' in fileError).toBe(false);

      const printed = formatFileError(fileError as never);
      expect(printed).toContain('ce.yml');
      expect(printed).toContain('EACCES');
    } finally {
      fs.chmodSync(file, 0o600);
    }
  });

  it('reports a read failure with the error code (directory as file)', () => {
    const result = readAndParseConfigFile(dir);
    expect(result.ok).toBe(false);
    const fileError = (result as unknown as { fileError: { kind: string; code: string; file: string } }).fileError;
    expect(fileError.kind).toBe('read');
    expect(fileError.code).toBe('EISDIR');
    expect(fileError.file).toBe(dir);
  });
});
