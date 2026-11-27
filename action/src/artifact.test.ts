import { describe, expect, it } from 'vitest';
import { buildArtifactLink, buildArtifactName } from './artifact.js';

// Validates: Requirements 7.2, 7.4, 7.5, 15.7

describe('buildArtifactName', () => {
  const base = {
    explicitName: '',
    runId: '123',
    runAttempt: '1',
    job: 'evidence',
    runDirName: 'run-2026-11-26T10-00-00-000Z',
  };

  it('builds the default name from the parts', () => {
    expect(buildArtifactName(base)).toBe(
      'ce-evidence-123-1-evidence-run-2026-11-26T10-00-00-000Z',
    );
  });

  it('gives two invocations in one job distinct names', () => {
    const first = buildArtifactName(base);
    const second = buildArtifactName({
      ...base,
      runDirName: 'run-2026-11-26T10-05-00-000Z',
    });
    expect(first).not.toBe(second);
  });

  it('uses a sanitized explicit name as the whole name', () => {
    expect(buildArtifactName({ ...base, explicitName: 'my:evidence/1' })).toBe(
      'my-evidence-1',
    );
  });
});

describe('buildArtifactLink', () => {
  const base = {
    serverUrl: 'https://github.com/',
    repository: 'rfxlamia/ce',
    runId: '123',
  };

  it('links to the artifact when the upload returned an id', () => {
    expect(buildArtifactLink({ ...base, upload: { id: 42 } })).toBe(
      'https://github.com/rfxlamia/ce/actions/runs/123/artifacts/42',
    );
  });

  it('falls back to the run URL when there is no id', () => {
    expect(buildArtifactLink({ ...base, upload: {} })).toBe(
      'https://github.com/rfxlamia/ce/actions/runs/123',
    );
  });

  it('returns an empty string when the upload failed', () => {
    expect(buildArtifactLink({ ...base, upload: undefined })).toBe('');
  });
});
