import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_CAPTURE_MAX_BYTES,
  LOG_TAIL_BYTES,
  TARGET_LOG_FILE,
  createLogCapture,
  type LogCapture,
} from './target.js';

const SECRET = 'sk-SECRETVALUE-12345';
const ENV = { OPENROUTER_API_KEY: SECRET };

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ce-target-log-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

/** Feed `chunks` to stdout, end the stream and return the released text. */
function feed(capture: LogCapture, chunks: string[]): string {
  for (const c of chunks) capture.write('stdout', c);
  capture.end('stdout');
  return capture.logs();
}

describe('stream labels and arrival order (Requirements 5.1, 5.2)', () => {
  it('keeps stdout and stderr text in arrival order with its label', () => {
    const c = createLogCapture({ env: {} });
    c.write('stdout', 'a1\n');
    c.write('stderr', 'b1\n');
    c.write('stdout', 'a2\n');
    expect(c.entries()).toEqual([
      { stream: 'stdout', text: 'a1\n' },
      { stream: 'stderr', text: 'b1\n' },
      { stream: 'stdout', text: 'a2\n' },
    ]);
    expect(c.logs()).toBe('a1\nb1\na2\n');
  });

  it('accepts Buffers and keeps a UTF-8 sequence split across chunks intact', () => {
    const c = createLogCapture({ env: {} });
    const euro = Buffer.from('€', 'utf8'); // 3 bytes
    c.write('stdout', euro.subarray(0, 1));
    c.write('stdout', euro.subarray(1));
    expect(c.logs()).toBe('€');
  });
});

describe('bound and tail (Requirements 5.3, 5.4)', () => {
  it('bounds the capture to 256 KiB and drops the oldest text first', () => {
    expect(LOG_CAPTURE_MAX_BYTES).toBe(262144);
    const c = createLogCapture({ env: {} });
    const a = 'a'.repeat(100000);
    const b = 'b'.repeat(100000);
    const d = 'd'.repeat(100000);
    c.write('stdout', a);
    c.write('stdout', b);
    c.write('stdout', d);
    const logs = c.logs();
    expect(Buffer.byteLength(logs, 'utf8')).toBe(LOG_CAPTURE_MAX_BYTES);
    expect(logs).toBe((a + b + d).slice(-LOG_CAPTURE_MAX_BYTES));
    expect(logs.startsWith('a')).toBe(true);
    expect(logs.endsWith('d')).toBe(true);
    expect(logs.length).toBeLessThan(300000);
  });

  it('cuts at a character boundary when the bound falls inside a multi-byte character', () => {
    const c = createLogCapture({ env: {}, maxBytes: 10 });
    c.write('stdout', '€€€€€'); // 15 bytes
    const logs = c.logs();
    expect(Buffer.byteLength(logs, 'utf8')).toBeLessThanOrEqual(10);
    expect(logs).toBe('€€€');
    expect(logs).not.toContain('\ufffd');
  });

  it('logTail returns at most the last 4 KiB of the capture', () => {
    expect(LOG_TAIL_BYTES).toBe(4096);
    const c = createLogCapture({ env: {} });
    const text = 'x'.repeat(10000) + 'END';
    c.write('stdout', text);
    const tail = c.tail();
    expect(Buffer.byteLength(tail, 'utf8')).toBe(4096);
    expect(tail).toBe(text.slice(-4096));
  });

  it('logTail never returns a partial multi-byte character', () => {
    const c = createLogCapture({ env: {} });
    c.write('stdout', 'é'.repeat(5000)); // 10000 bytes
    const tail = c.tail();
    expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(4096);
    expect(tail).toBe('é'.repeat(2048));
    expect(c.tail(10)).toBe('é'.repeat(5));
  });

  it('logTail returns the whole capture when it is short', () => {
    const c = createLogCapture({ env: {} });
    c.write('stdout', 'short');
    expect(c.tail()).toBe('short');
  });
});

describe('secret redaction (Requirements 5.5, 5.8, 5.11)', () => {
  it('replaces a secret value with ***', () => {
    const c = createLogCapture({ env: ENV });
    const out = feed(c, [`token=${SECRET} done\n`]);
    expect(out).toBe('token=*** done\n');
    expect(out).not.toContain(SECRET);
  });

  it('redacts the values of extra `secrets` names and both CE keys, ignoring empty values', () => {
    const c = createLogCapture({
      env: { MY_TOKEN: 'my-token-value', TYPESAFE_API_KEY: 'ts-key-value', EMPTY: '' },
      secrets: ['MY_TOKEN', 'EMPTY', 'ABSENT'],
    });
    const out = feed(c, ['my-token-value / ts-key-value / plain']);
    expect(out).toBe('*** / *** / plain');
  });

  it('redacts a secret split across two chunks', () => {
    const c = createLogCapture({ env: ENV });
    const out = feed(c, ['start ' + SECRET.slice(0, 8), SECRET.slice(8) + ' end']);
    expect(out).toBe('start *** end');
  });

  it('redacts a secret split across three chunks', () => {
    const c = createLogCapture({ env: ENV });
    const out = feed(c, ['a ' + SECRET.slice(0, 3), SECRET.slice(3, 11), SECRET.slice(11) + ' b']);
    expect(out).toBe('a *** b');
  });

  it('redacts a secret split one character at a time', () => {
    const c = createLogCapture({ env: ENV });
    const out = feed(c, [...`>${SECRET}<`]);
    expect(out).toBe('>***<');
  });

  it('redacts a secret that starts one character before the cut point', () => {
    const c = createLogCapture({ env: ENV });
    // chunk 1 ends right after the first character of the secret.
    const out = feed(c, ['pre ' + SECRET[0], SECRET.slice(1) + ' post']);
    expect(out).toBe('pre *** post');
  });

  it('never releases a fragment of a secret before the rest arrives', () => {
    const c = createLogCapture({ env: ENV });
    c.write('stdout', 'pre ' + SECRET.slice(0, SECRET.length - 1));
    expect(c.logs()).not.toContain(SECRET.slice(0, 4));
    c.write('stdout', SECRET.slice(-1));
    c.end('stdout');
    expect(c.logs()).toBe('pre ***');
  });

  it('redacts the whole buffer (Held_Tail plus new text) before the new Held_Tail is taken', () => {
    const secret = 'ABCDEFGH'; // hold length 7
    const c = createLogCapture({ env: { OPENROUTER_API_KEY: secret } });
    c.write('stdout', secret);
    // Redacted buffer is "***" (3 chars), shorter than the hold length: nothing released.
    expect(c.logs()).toBe('');
    c.write('stdout', 'zzzzzzzzzz');
    // "***zzzzzzzzzz" is 13 chars; the last 7 stay held, 6 are released, with no secret fragment.
    expect(c.logs()).toBe('***zzz');
    expect(c.logs()).not.toContain('ABC');
    c.end('stdout');
    expect(c.logs()).toBe('***zzzzzzzzzz');
  });

  it('replaces longer secret values first', () => {
    const c = createLogCapture({
      env: { OPENROUTER_API_KEY: 'ABC', TYPESAFE_API_KEY: 'ABCDEF' },
    });
    expect(feed(c, ['ABCDEF and ABC'])).toBe('*** and ***');
  });

  it('keeps separate Held_Tails per stream', () => {
    const c = createLogCapture({ env: ENV });
    c.write('stdout', SECRET.slice(0, 10));
    c.write('stderr', 'unrelated error output that is longer than the hold length\n');
    c.write('stdout', SECRET.slice(10));
    c.end('stdout');
    c.end('stderr');
    const logs = c.logs();
    expect(logs).not.toContain(SECRET);
    expect(logs).toContain('***');
    expect(c.entries().filter((e) => e.stream === 'stdout').map((e) => e.text).join('')).toBe('***');
  });
});

describe('Held_Tail flush (Requirements 5.8, 5.11)', () => {
  it('holds the last L-1 characters until the end of the stream', () => {
    const c = createLogCapture({ env: ENV });
    const text = 'hello world, nothing secret here';
    c.write('stdout', text);
    const held = SECRET.length - 1;
    expect(c.logs()).toBe(text.slice(0, text.length - held));
    c.end('stdout');
    expect(c.logs()).toBe(text);
  });

  it('flushes the Held_Tail and a pending partial UTF-8 sequence at end of stream', () => {
    const c = createLogCapture({ env: ENV });
    c.write('stdout', Buffer.from('ok €', 'utf8').subarray(0, 5)); // "ok " + first byte of €
    c.end('stdout');
    expect(c.logs()).toBe('ok \ufffd');
  });

  it('flushes both streams on stop()', async () => {
    const c = createLogCapture({ env: ENV });
    c.write('stdout', 'out tail');
    c.write('stderr', 'err tail');
    await c.stop();
    expect(c.logs()).toBe('out tailerr tail');
  });
});

describe('file output (Requirements 5.6, 5.9, 5.10)', () => {
  it('writes the redacted text to target.log under runDir', async () => {
    const c = createLogCapture({ env: ENV, runDir: tmp });
    c.write('stdout', `one ${SECRET}\n`);
    c.write('stderr', 'two\n');
    await c.stop();
    const file = await readFile(join(tmp, TARGET_LOG_FILE), 'utf8');
    expect(file).toBe('one ***\ntwo\n');
    expect(file).not.toContain(SECRET);
    expect(c.fileError()).toBeUndefined();
  });

  it('creates a missing runDir, including parents', async () => {
    const dir = join(tmp, 'nested', 'run');
    const c = createLogCapture({ env: {}, runDir: dir });
    c.write('stdout', 'hello');
    await c.stop();
    expect(await readFile(join(dir, TARGET_LOG_FILE), 'utf8')).toBe('hello');
  });

  it('writes no file when there is no runDir', async () => {
    const before = await readdir(tmp);
    const c = createLogCapture({ env: {} });
    c.write('stdout', 'hello');
    await c.stop();
    expect(await readdir(tmp)).toEqual(before);
    expect(c.fileError()).toBeUndefined();
    expect(c.logs()).toBe('hello');
  });

  it('keeps the whole stream in the file even when memory is bounded', async () => {
    const c = createLogCapture({ env: {}, runDir: tmp, maxBytes: 10 });
    c.write('stdout', '0123456789abcdef');
    await c.stop();
    expect(c.logs()).toBe('6789abcdef');
    expect(await readFile(join(tmp, TARGET_LOG_FILE), 'utf8')).toBe('0123456789abcdef');
  });

  it('reports a file error through fileError() instead of throwing', async () => {
    // runDir below a regular file cannot be created.
    const blocker = join(tmp, 'file');
    await (await import('node:fs/promises')).writeFile(blocker, 'x');
    const c = createLogCapture({ env: {}, runDir: join(blocker, 'sub') });
    c.write('stdout', 'still captured');
    await expect(c.stop()).resolves.toBeUndefined();
    expect(c.fileError()).toBeDefined();
    expect(c.logs()).toBe('still captured');
  });
});

describe('stop() (Requirement 5.7)', () => {
  it('discards chunks written after stop() and is idempotent', async () => {
    const c = createLogCapture({ env: {}, runDir: tmp });
    c.write('stdout', 'before');
    await c.stop();
    c.write('stdout', 'after');
    c.write('stderr', 'after');
    c.end('stdout');
    await c.stop();
    expect(c.logs()).toBe('before');
    expect(c.entries()).toEqual([{ stream: 'stdout', text: 'before' }]);
    expect(await readFile(join(tmp, TARGET_LOG_FILE), 'utf8')).toBe('before');
  });
});

describe('CE output channels (Requirement 11.9)', () => {
  it('writes nothing to the stdout or stderr of CE', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const c = createLogCapture({ env: ENV, runDir: tmp });
    c.write('stdout', `out ${SECRET}\n`);
    c.write('stderr', `err ${SECRET}\n`);
    c.end('stdout');
    await c.stop();
    c.write('stdout', 'late');
    c.tail();

    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
