import { describe, it } from 'vitest';
import fc from 'fast-check';
import { CANDIDATE_CAP, extractCandidates } from './candidates.js';
import type { BudgetedChangeContext, ChangedFile, Provenance } from './types.js';

const RUNS = { numRuns: 100 };
const gitProv = { provider: 'git' as const };

function ctx(over: Partial<BudgetedChangeContext['change']> = {}): BudgetedChangeContext {
  return {
    change: { files: [], commits: [], claims: [], provenance: [], ...over },
    checks: [],
    truncated: [],
    providers: [],
    redactions: [],
  };
}

const word = fc.stringMatching(/^[a-z]{3,8}$/);
const phrase = fc.array(word, { minLength: 1, maxLength: 5 }).map((w) => w.join(' '));
const sentence = phrase.map((p) => `${p}.`);
const prose = fc.array(sentence, { minLength: 1, maxLength: 5 });

function patchOf(path: string, added: string[]): ChangedFile {
  const patch = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${added.length} @@`,
    ...added.map((l) => `+${l}`),
  ].join('\n');
  return { path, status: 'added', patch, provenance: gitProv };
}

/** One generated source file per comment syntax of Requirement 9.8. */
const fileArb = fc
  .tuple(
    fc.constantFrom(
      { ext: 'ts', wrap: (t: string) => [`// ${t}`] },
      { ext: 'ts', wrap: (t: string) => [`/* ${t} */`] },
      { ext: 'ts', wrap: (t: string) => ['/**', ` * ${t}`, ' */'] },
      { ext: 'py', wrap: (t: string) => [`# ${t}`] },
      { ext: 'py', wrap: (t: string) => [`"""${t}"""`] },
      { ext: 'rb', wrap: (t: string) => [`# ${t}`] },
      { ext: 'sql', wrap: (t: string) => [`-- ${t}`] },
      { ext: 'html', wrap: (t: string) => [`<!-- ${t} -->`] },
      { ext: 'md', wrap: (t: string) => [`<!-- ${t} -->`] },
    ),
    fc.array(fc.tuple(phrase, fc.boolean()), { minLength: 1, maxLength: 6 }),
    word,
  )
  .map(([syn, items, name]) => {
    const lines: string[] = [];
    for (const [t, withCode] of items) {
      lines.push(...syn.wrap(t));
      if (withCode) lines.push('const x = 1');
    }
    return patchOf(`src/${name}.${syn.ext}`, lines);
  });

function addedLine(file: ChangedFile, lineNo: number): string {
  const added = file.patch
    .split('\n')
    .slice(4)
    .map((l) => l.slice(1));
  return added[lineNo - 1] ?? '';
}

describe('candidates properties', () => {
  // Feature: ce-context-resolver, Property 11: Every Claim_Candidate is a substring of its named source field
  it('Property 11: every candidate is a substring of its named source field', () => {
    // **Validates: Requirements 9.2, 9.3, 9.4, 11.3**
    fc.assert(
      fc.property(
        fc.record({
          title: prose,
          description: prose,
          commits: fc.array(prose, { maxLength: 3 }),
          claims: fc.array(phrase, { maxLength: 3 }),
          files: fc.array(fileArb, { maxLength: 3 }),
        }),
        (g) => {
          const files = g.files.map((f, i) => ({ ...f, path: `d${i}/${f.path}` }));
          const fields = new Map<string, string>();
          fields.set('title', g.title.join(' '));
          fields.set('description', g.description.join('\n\n'));
          const commits = g.commits.map((p, i) => {
            const message = p.join(' ');
            fields.set(`commit:${i}`, message);
            return { sha: `s${i}`, message, provenance: { provider: 'git' as const, location: `commit:${i}` } };
          });
          const claims = g.claims.map((t, i) => {
            fields.set(`--claim[${i}]`, t);
            return { text: t, provenance: { provider: 'cli' as const, location: `--claim[${i}]` } };
          });
          const out = extractCandidates(
            ctx({
              title: fields.get('title'),
              description: fields.get('description'),
              provenance: [
                { provider: 'github', location: 'title' },
                { provider: 'github', location: 'description' },
              ],
              commits,
              claims,
              files,
            }),
          );
          for (const c of out.candidates) {
            const loc = c.provenance.location ?? '';
            const field = fields.get(loc);
            if (field !== undefined) {
              if (!field.includes(c.text)) return false;
              continue;
            }
            const m = /^(.*):(\d+)$/.exec(loc);
            if (!m) return false;
            const f = files.find((x) => x.path === m[1]);
            if (!f || !addedLine(f, Number(m[2])).includes(c.text)) return false;
          }
          return true;
        },
      ),
      RUNS,
    );
  });

  // Feature: ce-context-resolver, Property 12: De-duplication keeps first occurrence; ids are sequential
  it('Property 12: de-duplication keeps first occurrence and ids are sequential', () => {
    // **Validates: Requirements 9.6, 9.7**
    const pool = fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'omega').map((w) => `${w}.`);
    fc.assert(
      fc.property(
        fc.array(pool, { minLength: 1, maxLength: 8 }),
        fc.array(pool, { minLength: 1, maxLength: 8 }),
        fc.array(pool, { maxLength: 3 }),
        (title, desc, claimTexts) => {
          const cliProv = (i: number): Provenance => ({ provider: 'cli', location: `--claim[${i}]` });
          const expected: { text: string; location: string }[] = [];
          const push = (text: string, location: string): void => {
            if (!expected.some((e) => e.text === text)) expected.push({ text, location });
          };
          claimTexts.forEach((t, i) => push(t, `--claim[${i}]`));
          title.forEach((t) => push(t, 'title'));
          desc.forEach((t) => push(t, 'description'));
          const out = extractCandidates(
            ctx({
              title: title.join(' '),
              description: desc.join(' '),
              provenance: [
                { provider: 'github', location: 'title' },
                { provider: 'github', location: 'description' },
              ],
              claims: claimTexts.map((t, i) => ({ text: t, provenance: cliProv(i) })),
            }),
          );
          return (
            out.candidates.length === expected.length &&
            out.candidates.every(
              (c, i) =>
                c.id === `c${i + 1}` &&
                c.text === expected[i]!.text &&
                c.provenance.location === expected[i]!.location,
            )
          );
        },
      ),
      RUNS,
    );
  });

  // Feature: ce-context-resolver, Property 13: Candidate cap keeps the first 50 in extraction order
  it('Property 13: candidate cap keeps the first 50 in extraction order', () => {
    // **Validates: Requirements 9.12**
    fc.assert(
      fc.property(fc.integer({ min: CANDIDATE_CAP + 1, max: 130 }), fc.integer({ min: 0, max: 20 }), (n, k) => {
        const claims = Array.from({ length: Math.min(k, n) }, (_, i) => ({
          text: `claim number ${i}`,
          provenance: { provider: 'cli' as const, location: `--claim[${i}]` },
        }));
        const sentences = Array.from({ length: n - claims.length }, (_, i) => `Sentence number ${i}.`);
        const out = extractCandidates(ctx({ description: sentences.join(' '), claims }));
        const all = [...claims.map((c) => c.text), ...sentences];
        return (
          out.candidates.length === CANDIDATE_CAP &&
          out.candidates.every((c, i) => c.id === `c${i + 1}` && c.text === all[i]) &&
          out.truncated?.file === '<candidates>' &&
          out.truncated.reason === 'candidate-cap'
        );
      }),
      RUNS,
    );
  });
});
