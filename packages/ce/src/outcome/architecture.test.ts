import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../jev/catalog.js';

// Architecture test for the outcome/ module boundaries.
// Requirements 1.5, 1.6, 1.7, 10.3, 10.4, 11.3.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/');
const isTest = (r: string): boolean => r.endsWith('.test.ts');
const isTestOnly = (r: string): boolean => r === 'outcome/arbitraries.ts';

interface Source {
  rel: string;
  /** Source text with comments removed. */
  code: string;
}

function stripComments(raw: string): string {
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

// Excluded from every rule: `*.test.ts` and the test-only `outcome/arbitraries.ts`.
const sources: Source[] = walk(SRC)
  .map((file) => ({ file, r: rel(file) }))
  .filter(({ r }) => !isTest(r) && !isTestOnly(r))
  .map(({ file, r }) => ({ rel: r, code: stripComments(readFileSync(file, 'utf8')) }));

function importSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) specs.push(m[1]!);
  return specs;
}

/** Specifiers of `import`/`export ... from` statements that are not `import type` / `export type`. */
function valueImportSpecifiers(code: string): string[] {
  const specs: string[] = [];
  for (const m of code.matchAll(/\b(?:import|export)\b([^'";]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    if (!/^\s*type\b/.test(m[1]!)) specs.push(m[2]!);
  }
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(m[1]!);
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  for (const m of code.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  return specs;
}

const LITERAL = '(?:SKIPPED|EVIDENCED|UNSUPPORTED|ERROR)';
const QUOTED = `['"\`]${LITERAL}['"\`]`;
// Assign (`outcome: 'X'`, `outcome = 'X'`), return (`return 'X'`, `=> 'X'`) or cast (`as 'X'`, `<'X'>`).
// A comparison such as `outcome === 'X'` is not matched.
const OUTCOME_LITERAL_USE = new RegExp(
  [
    `\\boutcome\\s*(?::|(?<![=!<>])=(?![=>]))\\s*${QUOTED}`,
    `\\breturn\\s+${QUOTED}`,
    `=>\\s*${QUOTED}`,
    `\\bas\\s+${QUOTED}`,
    `<\\s*${QUOTED}\\s*>`,
  ].join('|'),
);

const inOutcome = (r: string): boolean => r.startsWith('outcome/');
const scoped = sources.filter((s) => inOutcome(s.rel));

const FORBIDDEN_SPECIFIER = (spec: string): boolean =>
  spec === 'node:fs' ||
  spec === 'fs' ||
  spec === 'node:child_process' ||
  spec === 'child_process' ||
  spec === 'node:http' ||
  spec === 'node:https' ||
  spec === 'playwright' ||
  spec.startsWith('playwright/') ||
  spec === '@typesafe-ai/sdk' ||
  spec.startsWith('@typesafe-ai/sdk/') ||
  /(^|\/)jev(\/|$)/.test(spec) ||
  /(^|\/)runtime(\/|$)/.test(spec);

const TYPE_ONLY_TARGET = (spec: string): boolean =>
  /(^|\/)assessment(\/|$)/.test(spec) ||
  /(^|\/)context(\/|$)/.test(spec) ||
  /(^|\/)errors(\.js)?$/.test(spec);

describe('architecture: outcome/ boundaries', () => {
  it('scans a non-trivial set of source files', () => {
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((s) => isTest(s.rel) || isTestOnly(s.rel))).toBe(false);
    expect(scoped.map((s) => s.rel)).toEqual(
      expect.arrayContaining(['outcome/resolve.ts', 'outcome/types.ts']),
    );
    expect(scoped.every((s) => inOutcome(s.rel))).toBe(true);
  });

  it('(a) imports no fs, child_process, http, https, playwright, SDK, jev/ or runtime/ (1.5, 11.3)', () => {
    const offenders = scoped
      .filter((s) => importSpecifiers(s.code).some(FORBIDDEN_SPECIFIER))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(b) uses no process.env, Date, Math.random or performance (1.5)', () => {
    const re = /\bprocess\s*\.\s*env\b|\bDate\b|\bMath\s*\.\s*random\b|\bperformance\b/;
    const offenders = scoped.filter((s) => re.test(s.code)).map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(c) every import from assessment/, context/ or errors.ts is type-only (1.6, 11.3)', () => {
    const offenders = scoped
      .filter((s) => valueImportSpecifiers(s.code).some(TYPE_ONLY_TARGET))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});

describe('architecture: index.ts and run/ import boundaries', () => {
  // Requirements 1.5, 1.7, 2.6, 5.2, 13.11. Only the import rule applies here;
  // rules (a), (b), (c) stay scoped to outcome/.
  const runScoped = sources.filter((s) => s.rel === 'index.ts' || s.rel.startsWith('run/'));

  it('scans index.ts and the files of run/', () => {
    const rels = runScoped.map((s) => s.rel);
    expect(rels).toContain('index.ts');
    expect(rels).toEqual(
      expect.arrayContaining([
        'run/capabilities.ts',
        'run/command.ts',
        'run/index.ts',
        'run/pipeline.ts',
        'run/resolve.ts',
        'run/types.ts',
      ]),
    );
    expect(runScoped.some((s) => isTest(s.rel))).toBe(false);
  });

  it('do not import @typesafe-ai/sdk', () => {
    const offenders = runScoped
      .filter((s) =>
        importSpecifiers(s.code).some(
          (spec) => spec === '@typesafe-ai/sdk' || spec.startsWith('@typesafe-ai/sdk/'),
        ),
      )
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('do not call fetch', () => {
    const offenders = runScoped
      .filter((s) => /(?<![\w$.])(?:globalThis\s*\.\s*)?fetch\s*\(/.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('do not import jev/catalog', () => {
    const offenders = runScoped
      .filter((s) =>
        importSpecifiers(s.code).some((spec) => /(^|\/)jev\/catalog(\.js)?$/.test(spec)),
      )
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});

describe('architecture: runtime/target.ts boundaries', () => {
  // Requirements 4.10, 7.6, 8.8, 10.1, 10.2, 10.3. Rule (d) already scans every
  // non-test file in src/, so it covers runtime/target.ts once it is in `sources`.
  const target = sources.find((s) => s.rel === 'runtime/target.ts');

  it('is part of the scanned set that rule (d) covers', () => {
    expect(target).toBeDefined();
    expect(sources.map((s) => s.rel)).toContain('runtime/target.ts');
    expect(isTest('runtime/target.ts')).toBe(false);
  });

  it('imports none of playwright, @typesafe-ai/sdk, jev/ or outcome/', () => {
    const forbidden = (spec: string): boolean =>
      spec === 'playwright' ||
      spec.startsWith('playwright/') ||
      spec === '@typesafe-ai/sdk' ||
      spec.startsWith('@typesafe-ai/sdk/') ||
      /(^|\/)jev(\/|$)/.test(spec) ||
      /(^|\/)outcome(\/|$)/.test(spec);
    const all = importSpecifiers(target!.code);
    expect(all.filter(forbidden)).toEqual([]);
    expect(valueImportSpecifiers(target!.code).filter(forbidden)).toEqual([]);
    // Same pattern as the run/ check: the shared forbidden list must not match either.
    expect(
      all.filter((spec) => FORBIDDEN_SPECIFIER(spec) && !/^(node:fs|fs|node:child_process|child_process)$/.test(spec)),
    ).toEqual([]);
  });

  it('does not call fetch with a Jev-shaped request body', () => {
    // target.ts may call fetch for readiness probes (GET, no body). A Jev request
    // carries a body, questions, assets or a Jev/OpenRouter endpoint.
    expect(target!.code).not.toMatch(
      /\bbody\s*:|\bquestions\s*:|\bassets\s*:|data_base64|systemone|openrouter\.ai|typesafe\.(?:ai|com)|\bmethod\s*:\s*['"`]POST/i,
    );
  });

  it('contains no Jev question text', () => {
    const texts: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') texts.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    for (const e of [
      CATALOG.claimIsBehavior,
      CATALOG.assessRuntimeObservable,
      CATALOG.assessChecksAdequate,
      CATALOG.assessSurface,
      CATALOG.runtimeStateReachedDom,
      CATALOG.runtimeStateReached,
      CATALOG.runtimeLocateSubject,
    ]) {
      collect(e.build());
    }
    collect(CATALOG.runtimeNextAction.build([]));
    const long = texts.filter((t) => t.length >= 20);
    expect(long.length).toBeGreaterThan(0);
    expect(long.filter((t) => target!.code.includes(t))).toEqual([]);
  });
});

/** Specifiers of static `import`/`export ... from` and side-effect imports that are not type-only. */
function staticValueImportSpecifiers(code: string): string[] {
  const specs: string[] = [];
  for (const m of code.matchAll(/\b(?:import|export)\b([^'";]*?)\bfrom\s*['"]([^'"]+)['"]/g)) {
    if (!/^\s*type\b/.test(m[1]!)) specs.push(m[2]!);
  }
  for (const m of code.matchAll(/(?:^|[;\s])import\s*['"]([^'"]+)['"]/g)) specs.push(m[1]!);
  return specs;
}

describe('architecture: runtime/ boundaries', () => {
  // Requirements 9.10, 10.4, 12.9, 12.17, 13.16. Production files of runtime/ only;
  // `*.testsupport.ts` helpers are test infrastructure and are excluded.
  const runtimeScoped = sources.filter(
    (s) => s.rel.startsWith('runtime/') && !s.rel.endsWith('.testsupport.ts'),
  );

  it('scans the runtime/ modules of the loop', () => {
    expect(runtimeScoped.map((s) => s.rel)).toEqual(
      expect.arrayContaining([
        'runtime/capability.ts',
        'runtime/capture.ts',
        'runtime/decide.ts',
        'runtime/execute.ts',
        'runtime/loop.ts',
        'runtime/observe.ts',
        'runtime/target.ts',
      ]),
    );
    expect(runtimeScoped.some((s) => isTest(s.rel) || s.rel.endsWith('.testsupport.ts'))).toBe(false);
  });

  it('import no @typesafe-ai/sdk', () => {
    const offenders = runtimeScoped
      .filter((s) =>
        importSpecifiers(s.code).some(
          (spec) => spec === '@typesafe-ai/sdk' || spec.startsWith('@typesafe-ai/sdk/'),
        ),
      )
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('do not call fetch for Jev', () => {
    // `route.fetch(...)` is a Playwright method call and is not matched (preceded by `.`).
    // target.ts is covered by its own readiness-probe rule above.
    const offenders = runtimeScoped
      .filter((s) => s.rel !== 'runtime/target.ts')
      .filter((s) => /(?<![\w$.])(?:globalThis\s*\.\s*)?fetch\s*\(/.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
    const jevShaped = runtimeScoped
      .filter((s) => /data_base64|systemone|openrouter\.ai|typesafe\.(?:ai|com)/i.test(s.code))
      .map((s) => s.rel);
    expect(jevShaped).toEqual([]);
  });

  it('import no outcome/resolve.ts', () => {
    const offenders = runtimeScoped
      .filter((s) =>
        importSpecifiers(s.code).some((spec) => /(^|\/)outcome\/resolve(\.js)?$/.test(spec)),
      )
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('declare no Jev question text', () => {
    const texts: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') texts.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    for (const e of [
      CATALOG.claimIsBehavior,
      CATALOG.assessRuntimeObservable,
      CATALOG.assessChecksAdequate,
      CATALOG.assessSurface,
      CATALOG.runtimeStateReachedDom,
      CATALOG.runtimeStateReached,
      CATALOG.runtimeLocateSubject,
    ]) {
      collect(e.build());
    }
    collect(CATALOG.runtimeNextAction.build([]));
    const long = texts.filter((t) => t.length >= 20);
    expect(long.length).toBeGreaterThan(0);
    const offenders = runtimeScoped
      .filter((s) => long.some((t) => s.code.includes(t)))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('no module reachable statically from index.ts imports playwright', () => {
    const byRel = new Map(sources.map((s) => [s.rel, s]));
    const resolveSpec = (from: string, spec: string): string | undefined => {
      if (!spec.startsWith('.')) return undefined;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
      const stem = base.replace(/\.js$/, '');
      return [`${stem}.ts`, `${stem}/index.ts`].find((c) => byRel.has(c));
    };
    const seen = new Set<string>();
    const queue = ['index.ts'];
    const offenders: string[] = [];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const code = byRel.get(current)?.code ?? '';
      for (const spec of staticValueImportSpecifiers(code)) {
        if (spec === 'playwright' || spec.startsWith('playwright/')) offenders.push(current);
        const next = resolveSpec(current, spec);
        if (next) queue.push(next);
      }
    }
    expect(offenders).toEqual([]);
    // The walk must actually reach the pipeline and the capability.
    expect([...seen]).toEqual(
      expect.arrayContaining(['run/pipeline.ts', 'runtime/capability.ts']),
    );
  });

  it('runtime/capability.ts loads playwright only through a dynamic import', () => {
    const capability = sources.find((s) => s.rel === 'runtime/capability.ts');
    expect(capability).toBeDefined();
    expect(staticValueImportSpecifiers(capability!.code).filter((s) => s === 'playwright')).toEqual([]);
    expect(capability!.code).toMatch(/import\(\s*['"]playwright['"]\s*\)/);
  });
});

describe('architecture: Outcome literals across src/', () => {
  it('(d) only outcome/resolve.ts assigns, returns or casts to an Outcome literal (1.7, 10.3, 10.4)', () => {
    const offenders = sources
      .filter((s) => s.rel !== 'outcome/resolve.ts')
      .filter((s) => OUTCOME_LITERAL_USE.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('(e) outcome/resolve.ts is detected as the one deciding file', () => {
    const resolve = sources.find((s) => s.rel === 'outcome/resolve.ts');
    expect(resolve).toBeDefined();
    expect(OUTCOME_LITERAL_USE.test(resolve!.code)).toBe(true);
  });

  it("(f) outcome/types.ts holds the literals only in OUTCOMES (1.7)", () => {
    const types = sources.find((s) => s.rel === 'outcome/types.ts');
    expect(types).toBeDefined();
    expect(types!.code).toMatch(/OUTCOMES\s*=\s*\[[^\]]*SKIPPED[^\]]*\]\s*as const/);
    const withoutOutcomes = types!.code.replace(/export const OUTCOMES\s*=\s*\[[^\]]*\]\s*as const;?/, '');
    expect(new RegExp(QUOTED).test(withoutOutcomes)).toBe(false);
  });
});

describe('architecture: checker self-tests', () => {
  it('does not report a comparison against an Outcome literal', () => {
    const code = stripComments(
      "if (resolution.outcome === 'EVIDENCED') { run(); }\n" +
        "const bad = resolution.outcome !== 'ERROR';\n" +
        "const ok = (r: { outcome: string }) => r.outcome === 'SKIPPED';\n",
    );
    expect(OUTCOME_LITERAL_USE.test(code)).toBe(false);
  });

  it.each([
    ["const r = { outcome: 'EVIDENCED' };"],
    ["let x; x.outcome = 'SKIPPED';"],
    ["function f() { return 'UNSUPPORTED'; }"],
    ["const f = () => 'ERROR';"],
    ["const o = value as 'EVIDENCED';"],
  ])('reports an assignment, return or cast: %s', (snippet) => {
    expect(OUTCOME_LITERAL_USE.test(snippet)).toBe(true);
  });

  it('flags a value import and accepts a type import from errors.ts', () => {
    expect(valueImportSpecifiers("import { StageError } from '../errors.js';")).toEqual([
      '../errors.js',
    ]);
    expect(valueImportSpecifiers("import type { StageError } from '../errors.js';")).toEqual([]);
  });
});
