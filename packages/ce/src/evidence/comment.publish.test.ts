// Example tests for the publishResult extension of renderPrComment
// (Requirements 9.1, 9.2, 9.6, 9.8, 9.11, 9.13, 10.2, 16.5).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { COMMENT_MARKER, renderPrComment, type CommentInput } from './comment.js';
import { buildImageUrl } from './image-url.js';
import { evidencedRunRecordArb } from './arbitraries.js';
import { fallbackNote, type FallbackReason, type PublishResult } from './publish-types.js';

const SHA = 'b'.repeat(40);
const ARTIFACT = 'https://github.com/o/r/actions/runs/1/artifacts/2';
const base = { serverUrl: 'https://github.com', repository: 'o/r', prNumber: 7 };
const [sampled] = fc.sample(evidencedRunRecordArb, 1);
const record = { ...sampled!, claims: [] } as unknown as CommentInput['record'];

const url = (file: string, runId = 'run-1'): string =>
  buildImageUrl({ serverUrl: base.serverUrl, owner: 'o', repo: 'r', sha: SHA, prNumber: 7, runId, file });

const render = (publishResult?: PublishResult): string =>
  renderPrComment({ record, artifactLink: ARTIFACT, secrets: [], publishResult, ...base });

const published = (imageUrls: string[], skippedCount = 0, finalIncluded = true, stepNumbers?: number[]): PublishResult => ({
  kind: 'published',
  sha: SHA,
  imageUrls,
  finalIncluded,
  stepNumbers: stepNumbers ?? Array.from({ length: imageUrls.length - (finalIncluded ? 1 : 0) }, (_, i) => i + 1),
  skippedCount,
});

const imgTags = (body: string): string[] => body.match(/<img [^>]*>/g) ?? [];

describe('published without a final screenshot', () => {
  it('renders no final line and labels every image as a step', () => {
    const urls = [url('step-1.png'), url('step-3.png')];
    const body = render(published(urls, 1, false, [2, 4]));
    expect(body).not.toContain('Final screenshot');
    expect(body).not.toContain('final screenshot');
    expect(imgTags(body)).toEqual([
      `<img src="${urls[0]}" alt="step 2 screenshot" width="160">`,
      `<img src="${urls[1]}" alt="step 4 screenshot" width="160">`,
    ]);
    expect(body).toContain('(+1 more screenshots in the artifact)');
  });

  it('keeps the step label when a leading step URL fails re-validation', () => {
    const body = render(published(['https://evil.example/x.png', url('step-1.png')], 0, false, [1, 2]));
    expect(imgTags(body)).toEqual([`<img src="${url('step-1.png')}" alt="step 2 screenshot" width="160">`]);
  });
});

describe('published', () => {
  it('shows the final screenshot inline between the rationale and the artifact link', () => {
    const body = render(published([url('final.png')]));
    const md = `![final screenshot](${url('final.png')})`;
    expect(body).toContain(md);
    expect(body.indexOf('Why:')).toBeLessThan(body.indexOf(md));
    expect(body.indexOf(md)).toBeLessThan(body.indexOf(`Artifact: ${ARTIFACT}`));
    expect(body).not.toContain('<details>');
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
    expect(body.startsWith(`${COMMENT_MARKER}\nOutcome: EVIDENCED`)).toBe(true);
  });

  it('puts step thumbnails in one <details> block in Step order', () => {
    const urls = [url('final.png'), url('step-0.png'), url('step-1.png'), url('step-2.png')];
    const body = render(published(urls));
    expect(body.match(/<details>/g)).toHaveLength(1);
    expect(body).toContain('<summary>');
    expect(imgTags(body)).toEqual([
      `<img src="${urls[1]}" alt="step 1 screenshot" width="160">`,
      `<img src="${urls[2]}" alt="step 2 screenshot" width="160">`,
      `<img src="${urls[3]}" alt="step 3 screenshot" width="160">`,
    ]);
    expect(body.indexOf('</details>')).toBeGreaterThan(body.lastIndexOf('<img'));
    expect(body.indexOf('</details>')).toBeLessThan(body.indexOf('Artifact:'));
  });

  it('ends the <details> block with the skipped-count line', () => {
    const body = render(published([url('final.png'), url('step-0.png')], 3));
    expect(body).toMatch(/\(\+3 more screenshots in the artifact\)\n<\/details>/);
  });

  it('puts the skipped-count line after the final screenshot when there is no <details>', () => {
    const body = render(published([url('final.png')], 4));
    expect(body).not.toContain('<details>');
    expect(body).toMatch(
      new RegExp(`!\\[final screenshot\\]\\([^)]*\\)\\n\\(\\+4 more screenshots in the artifact\\)\\n\\nArtifact:`),
    );
  });

  it('omits the skipped-count line when nothing was skipped', () => {
    expect(render(published([url('final.png'), url('step-0.png')]))).not.toContain('more screenshots');
  });

  it('counts URLs that fail re-validation in N', () => {
    const body = render(published([url('final.png'), 'https://evil.example/x.png', url('step-1.png')], 1));
    expect(body).not.toContain('evil.example');
    expect(body).toContain('(+2 more screenshots in the artifact)');
  });

  it('drops every URL when the repository does not match', () => {
    const body = renderPrComment({
      record,
      artifactLink: ARTIFACT,
      secrets: [],
      publishResult: published([url('final.png')]),
      ...base,
      repository: 'other/repo',
    });
    expect(body).not.toMatch(/!\[|<img/);
    expect(body).toContain('(+1 more screenshots in the artifact)');
  });

  it('increases N by the thumbnails dropped to fit the 60000 character ceiling', () => {
    const longRun = 'r'.repeat(100);
    const thumbs = Array.from({ length: 600 }, (_, i) => url(`step-${i}.png`, longRun));
    const body = render(published([url('final.png', longRun), ...thumbs], 2));
    const shown = imgTags(body).length;
    expect(body.length).toBeLessThanOrEqual(60000);
    expect(shown).toBeLessThan(600);
    expect(body).toContain(`(+${2 + (600 - shown)} more screenshots in the artifact)`);
    expect(body).toContain('![final screenshot](');
    expect(body).toContain(`Artifact: ${ARTIFACT}`);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('uses the word observation and none of the verdict words for the image section', () => {
    const body = render(published([url('final.png'), url('step-0.png')]));
    const section = body.slice(body.indexOf('Final screenshot'), body.indexOf('Artifact:'));
    expect(section).toMatch(/observation/);
    expect(section).not.toMatch(/\b(passed|failed|verified|correct)\b/i);
  });
});

describe('fallback', () => {
  const reasons: FallbackReason[] = [
    'fork-pr',
    'no-pr-number',
    'no-images',
    'token-lacks-write',
    'push-blocked',
    'push-conflict-exhausted',
    'ref-guard',
    'git-error',
  ];

  it.each(reasons)('%s: its note, the artifact link, and no image markup', (reason) => {
    const body = render({ kind: 'fallback', reason });
    expect(body).toContain(fallbackNote(reason));
    expect(body).toContain(`Artifact: ${ARTIFACT}`);
    expect(body).not.toMatch(/!\[|<img|<details/);
    expect(body.split(COMMENT_MARKER)).toHaveLength(2);
  });

  it('writes the exact fork note', () => {
    expect(render({ kind: 'fallback', reason: 'fork-pr' })).toContain('publish skipped: fork PR');
  });

  it('a failed confirmation (git-error) shows no pushed commit reference', () => {
    // Requirement 9.13: the publisher returns a git-error fallback and never a published result.
    const body = render({ kind: 'fallback', reason: 'git-error' });
    expect(body).not.toContain(SHA);
    expect(body).not.toMatch(/\/raw\/|\b[0-9a-f]{40}\b/);
    expect(body).toContain('publish skipped: a Git error occurred (see the workflow log)');
  });
});

describe('not-attempted', () => {
  it('is identical to the earlier output (field omitted) and has no image or note', () => {
    const body = render({ kind: 'not-attempted' });
    expect(body).toBe(render(undefined));
    expect(body).toBe(
      renderPrComment({ record, artifactLink: ARTIFACT, secrets: [] }),
    );
    expect(body).not.toMatch(/!\[|<img|<details|publish skipped/);
  });
});
