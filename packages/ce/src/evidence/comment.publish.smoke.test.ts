// Minimal checks for the publishResult extension of renderPrComment (Requirement 9).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { COMMENT_MARKER, renderPrComment } from './comment.js';
import { buildImageUrl } from './image-url.js';
import { evidencedRunRecordArb } from './arbitraries.js';

const SHA = 'a'.repeat(40);
const base = { serverUrl: 'https://github.com', repository: 'o/r', prNumber: 7 };
const url = (file: string): string =>
  buildImageUrl({ serverUrl: base.serverUrl, owner: 'o', repo: 'r', sha: SHA, prNumber: 7, runId: 'run-1', file });
const [record] = fc.sample(evidencedRunRecordArb, 1);
const render = (publishResult?: Parameters<typeof renderPrComment>[0]['publishResult'], extra = {}): string =>
  renderPrComment({ record: record!, artifactLink: 'https://github.com/o/r/actions/runs/1', secrets: [], publishResult, ...base, ...extra });

describe('renderPrComment publishResult', () => {
  it('published: final inline, steps in details, skipped line ends the block', () => {
    const body = render({
      kind: 'published',
      sha: SHA,
      imageUrls: [url('step-2-final.png'), url('step-0.png'), url('step-1.png')],
      skippedCount: 2,
    });
    expect(body).toContain(`![final screenshot](${url('step-2-final.png')})`);
    expect(body).toContain(`<img src="${url('step-0.png')}" alt="step 1 screenshot" width="160">`);
    expect(body).toMatch(/\(\+2 more screenshots in the artifact\)\n<\/details>/);
    expect(body.split(COMMENT_MARKER).length).toBe(2);
    expect(body.indexOf('![final')).toBeLessThan(body.indexOf('Artifact:'));
  });

  it('drops URLs that do not match the repository and counts them', () => {
    const body = render({ kind: 'published', sha: SHA, imageUrls: [url('f.png'), 'https://evil.example/x.png'], skippedCount: 0 });
    expect(body).not.toContain('evil.example');
    expect(body).toContain('(+1 more screenshots in the artifact)');
  });

  it('fallback: note and artifact link, no image markup', () => {
    const body = render({ kind: 'fallback', reason: 'fork-pr' });
    expect(body).toContain('publish skipped: fork PR');
    expect(body).toContain('Artifact:');
    expect(body).not.toMatch(/!\[|<img|<details/);
  });

  it('not-attempted equals the omitted field', () => {
    expect(render({ kind: 'not-attempted' })).toBe(render(undefined));
  });
});
