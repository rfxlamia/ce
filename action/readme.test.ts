import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');
const manifest = parse(readFileSync(resolve(repoRoot, 'action.yml'), 'utf8')) as {
  inputs?: Record<string, unknown>;
};
const declaredInputs = new Set(Object.keys(manifest.inputs ?? {}));

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  permissions?: Record<string, string>;
  jobs?: Record<string, { steps?: Step[]; permissions?: Record<string, string> }>;
}

function yamlBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /^[ \t]*```yaml[ \t]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    blocks.push(m[1] ?? '');
  }
  return blocks;
}

function findExample(): Workflow {
  for (const block of yamlBlocks(readme)) {
    if (!block.includes('rfxlamia/ce@')) continue;
    return parse(block) as Workflow;
  }
  throw new Error('README has no fenced yaml block that uses rfxlamia/ce');
}

const workflow = findExample();
const steps = Object.values(workflow.jobs ?? {}).flatMap((j) => j.steps ?? []);
const ceStep = steps.find((s) => s.uses?.startsWith('rfxlamia/ce@'));

describe('README Action example', () => {
  it('has a rfxlamia/ce step (Req 13.8)', () => {
    expect(ceStep).toBeDefined();
  });

  it('uses only inputs declared in action.yml under with: (Req 13.8)', () => {
    const keys = Object.keys(ceStep?.with ?? {});
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(declaredInputs.has(key), `undeclared input: ${key}`).toBe(true);
    }
  });

  it('declares contents: read and pull-requests: write (Req 13.8)', () => {
    expect(workflow.permissions?.contents).toBe('read');
    expect(workflow.permissions?.['pull-requests']).toBe('write');
  });
});

describe('README credentials', () => {
  it('contains no key-like credential value (Req 13.9)', () => {
    const patterns = [
      /sk-[A-Za-z0-9_-]{16,}/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}/,
      /github_pat_[A-Za-z0-9_]{20,}/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bBearer\s+[A-Za-z0-9._-]{20,}/,
    ];
    for (const p of patterns) expect(readme).not.toMatch(p);
    // A credential-named variable must never be assigned a literal value.
    const assignments = readme.matchAll(
      /\b(?:OPENROUTER_API_KEY|TYPESAFE_API_KEY|[A-Z_]*(?:TOKEN|SECRET|PASSWORD))[ \t]*[:=][ \t]*(\S.*)$/gm,
    );
    for (const m of assignments) {
      expect((m[1] ?? '').trim(), `literal credential value: ${m[0]}`).toMatch(/^\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}$/);
    }
  });

  it('references secrets only through ${{ secrets.NAME }} (Req 13.9)', () => {
    const mentions = readme.match(/secrets\.[^\s}]*/g) ?? [];
    expect(mentions.length).toBeGreaterThan(0);
    for (const ref of readme.matchAll(/\$\{\{([^}]*)\}\}/g)) {
      const expr = (ref[1] ?? '').trim();
      if (expr.startsWith('secrets.')) {
        expect(expr).toMatch(/^secrets\.(?:[A-Za-z0-9_]+|\*)$/);
      }
    }
    const example = yamlBlocks(readme).find((b) => b.includes('rfxlamia/ce@')) ?? '';
    expect(example).toContain('${{ secrets.OPENROUTER_API_KEY }}');
  });
});

// Section helpers. A missing heading yields -1 or '', so each new test fails on
// its own with "expected '' to contain ..." instead of breaking the whole file.
function headingOffset(heading: string): number {
  return readme.search(new RegExp(`^${heading}$`, 'm'));
}

function sectionText(heading: string): string {
  const at = headingOffset(heading);
  if (at === -1) return '';
  const rest = readme.slice(readme.indexOf('\n', at) + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('README publish: branch (Req 14)', () => {
  const publishing = () => sectionText('### Publishing screenshots \\(`publish: branch`\\)');
  const flat = () => publishing().replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
  const flatReadme = () => readme.replace(/^>\s?/gm, '').replace(/\s+/g, ' ');

  it('no longer says publish: branch is not implemented (Req 14.1)', () => {
    expect(readme).not.toMatch(/not implemented/i);
    expect(readme).not.toMatch(/publish: branch[^\n]*(?:reserved|unsupported)/i);
  });

  it('describes publish none | branch, the default, and the ce.yml key (Req 14.1)', () => {
    const text = flat();
    expect(text).toContain('`publish` takes `none` (the default) or `branch`');
    expect(text).toContain('In `ce.yml` the key is `publish`');
  });

  it('lists the publish and token inputs with defaults in the inputs table (Req 14.2)', () => {
    expect(readme).toMatch(/^\| `publish` \| `'none'` \|/m);
    expect(readme).toMatch(/^\| `publish-max-images` \| `''` \(6\) \|/m);
    expect(readme).toMatch(/^\| `publish-max-image-bytes` \| `''` \(5242880\) \|/m);
    expect(readme).toMatch(/^\| `token` \| `''` \|/m);
    expect(readme).toMatch(/^\| `github-token` \| `''` \| Alias of `token`/m);
    expect(readme).toMatch(/^\| `default-token` \| .*Internal\./m);
  });

  it('shows permissions for both modes (Req 14.2)', () => {
    const perms = sectionText('### Permissions');
    expect(perms).toMatch(/`none`[^\n]*`contents: read`[^\n]*`pull-requests: write`/);
    expect(perms).toMatch(/`branch`[^\n]*`contents: write`[^\n]*`pull-requests: write`/);
    expect(publishing()).toContain('contents: write');
  });

  it('states the orphan branch, path, and no force-push (Req 14.3)', () => {
    const text = flat();
    expect(text).toContain('orphan branch `ce-evidence`');
    expect(text).toContain('`pr-<n>/<run-id>/`');
    expect(text).toContain('never force-pushes');
    expect(text).toContain('never pushes to a code branch');
  });

  it('states fork behavior, protection fallback, retry limit and cap default (Req 14.4)', () => {
    const text = flat();
    expect(text).toContain('publish skipped: fork PR');
    expect(text).toMatch(/branch protection rule or ruleset/);
    expect(text).toContain('at most 3 retries');
    expect(text).toMatch(/at most 6 images per run by default/);
  });

  it('states the per-image limit and that oversize images stay in the Artifact (Req 14.12)', () => {
    const text = flat();
    expect(text).toContain('5 MiB by default (`publish-max-image-bytes`)');
    expect(text).toMatch(/oversize image stays in the Artifact and counts as skipped/);
  });

  it('states comment: false publishes nothing and CE uses the runner git (Req 14.13)', () => {
    const text = flat();
    expect(text).toContain('`publish: branch` with `comment: false` publishes nothing');
    expect(text).toContain('system `git` binary of the runner');
  });

  it('advises excluding ce-evidence and notes the GitHub App token loop guard (Req 14.6)', () => {
    const text = flatReadme();
    expect(text).toContain('exclude `ce-evidence` from your other workflows');
    expect(text).toContain('A GitHub App token passed as `token` can trigger workflows on the pushed branch');
    expect(text).toContain('CE guards against its own loop');
  });

  it('states permanence, no deletion, and the sensitive-data warning (Req 14.7, 14.11)', () => {
    const text = flatReadme();
    expect(text).toContain('Images stay on the `ce-evidence` branch until a maintainer prunes it');
    expect(text).toContain('This feature has no deletion');
    expect(text).toMatch(/Artifacts expire \(about 90 days by default\)/);
    expect(text).toMatch(/can show sensitive data/);
    expect(text).toContain('In a public repository the images are public');
    expect(text).toContain('Do not use `publish: branch` when the Subject can show sensitive data');
  });

  it('states the clone-weight trade-off and how to avoid it (Req 14.10)', () => {
    const text = flatReadme();
    expect(text).toContain('Clone weight');
    expect(text).toContain('`fetch-depth: 0`');
    expect(text).toContain('with `--depth 1`');
    expect(text).toMatch(/shallow checkout, a `single-branch` clone, or a refspec that excludes\s*`ce-evidence`/);
  });

  it('has a Private_Render_Check paragraph that links the verification file (Req 14.5, 15.3)', () => {
    const para = sectionText('#### Private repositories').replace(/^>\s?/gm, '').replace(/\s+/g, ' ');
    expect(para).toContain('private-repo-image-verification.md');
    expect(para).toContain('.kiro/specs/inline-screenshot-in-pr/private-repo-image-verification.md');
    // The check is DEFERRED: accept the unverified status (with the
    // publish: none fallback) or a recorded result that names both viewers.
    const pending = /Status: unverified/i.test(para) && para.includes('publish: none');
    const recorded = /read access/i.test(para) && /without access|logged out/i.test(para);
    expect(pending || recorded, 'paragraph is neither pending nor a recorded result').toBe(true);
  });

  it('example workflow YAML blocks are valid (Req 14.8)', () => {
    const blocks = yamlBlocks(readme);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(() => parse(block)).not.toThrow();
  });
});

describe('README Development', () => {
  it('no longer describes the CLI as a stub', () => {
    expect(readme).not.toContain('stub for now');
  });
});

describe('README Quick start', () => {
  const quick = () => sectionText('## Quick start');

  it('has a Quick start section before GitHub Action', () => {
    const quickAt = headingOffset('## Quick start');
    expect(quickAt, 'missing ## Quick start section').toBeGreaterThanOrEqual(0);
    expect(headingOffset('## GitHub Action')).toBeGreaterThan(quickAt);
  });

  it('shows the local install and init commands', () => {
    expect(quick()).toContain('npm i -D continuous-evidence');
    expect(quick()).toContain('npx ce init');
  });

  it('shows the global install and npx continuous-evidence alternatives', () => {
    expect(quick()).toContain('npm i -g continuous-evidence && ce init');
    expect(quick()).toContain('npx continuous-evidence init');
  });

  it('shows the API key, browser install and run steps', () => {
    expect(quick()).toContain('OPENROUTER_API_KEY');
    expect(quick()).toContain('npx playwright install chromium');
    expect(quick()).toContain('npx ce run');
  });

  it('warns that bare npx ce resolves to the unrelated ce package', () => {
    expect(quick()).toContain('bare `npx ce`');
    expect(quick()).toContain('unrelated `ce` package');
  });

  it('uses sh code blocks and no yaml block', () => {
    expect(quick()).toContain('```sh');
    expect(quick()).not.toContain('```yaml');
    expect(quick()).not.toContain('```bash');
  });
});

describe('README Releasing runbook', () => {
  const releasing = () => sectionText('## Releasing');

  it('has a Releasing section before License', () => {
    const releasingAt = headingOffset('## Releasing');
    expect(releasingAt, 'missing ## Releasing section').toBeGreaterThanOrEqual(0);
    expect(headingOffset('## License')).toBeGreaterThan(releasingAt);
  });

  it('documents the manual first publish', () => {
    expect(releasing()).toContain('npm login');
    expect(releasing()).toContain('npm publish --workspace continuous-evidence --access public');
  });

  it('documents the trusted publisher for rfxlamia/ce and release.yml', () => {
    expect(releasing()).toMatch(/trusted publisher/i);
    expect(releasing()).toContain('rfxlamia/ce');
    expect(releasing()).toContain('release.yml');
  });

  it('documents the vX.Y.Z tag matching packages/ce/package.json', () => {
    expect(releasing()).toContain('vX.Y.Z');
    expect(releasing()).toContain('packages/ce/package.json');
    expect(releasing()).toContain('make bump VERSION=X.Y.Z');
    expect(releasing()).toContain('make tag VERSION=X.Y.Z');
  });

  it('states that one tag releases the Action and npm together', () => {
    expect(releasing()).toContain('Pushing one tag releases the GitHub Action and the npm package together.');
  });

  it('documents moving the v0 major tag to the release', () => {
    expect(releasing()).toContain('make move-major VERSION=X.Y.Z');
    expect(releasing()).toContain('make gh-release VERSION=X.Y.Z');
    expect(releasing()).toContain('git tag -f -a v0');
    expect(releasing()).toContain('--force-with-lease=refs/tags/v0:');
  });

  it('documents prerelease versions on the next dist-tag', () => {
    expect(releasing()).toMatch(/prerelease[^\n]*`next`/i);
  });

  it('mentions the optional 2FA and no-token setting', () => {
    expect(releasing()).toContain('Require 2FA and disallow tokens');
  });
});
