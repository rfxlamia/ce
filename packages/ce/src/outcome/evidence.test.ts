import { describe, expect, it } from 'vitest';
import { satisfiesMinimumEvidence, type EvidenceSummary } from './evidence.js';

function passing(): EvidenceSummary {
  return {
    change: { title: 'Add login button', files: ['src/login.ts'] },
    claim: {
      status: 'identified',
      id: 'c1',
      text: 'The login button opens the dialog',
      provenance: { provider: 'cli' },
    },
    subject: { url: 'http://localhost:3000' },
    actions: [{ kind: 'click', description: 'Click the login button' }],
    observations: [{ step: 1, screenshot: 'shots/001.png' }],
    artifacts: { runDir: '.ce/runs/r1', reportPath: '.ce/runs/r1/report.html' },
  };
}

describe('satisfiesMinimumEvidence', () => {
  it('accepts a minimal passing summary (Requirement 7.3)', () => {
    expect(satisfiesMinimumEvidence(passing())).toBe(true);
  });

  it('accepts a not_identified claim that carries no text (Requirements 7.3, 7.4)', () => {
    const summary: EvidenceSummary = { ...passing(), claim: { status: 'not_identified' } };
    expect(satisfiesMinimumEvidence(summary)).toBe(true);
  });

  it('rejects an identified claim with whitespace-only text (Requirement 7.5)', () => {
    const base = passing();
    const summary: EvidenceSummary = {
      ...base,
      claim: { status: 'identified', id: 'c1', text: ' \t\n ', provenance: { provider: 'cli' } },
    };
    expect(satisfiesMinimumEvidence(summary)).toBe(false);
  });

  it('rejects an empty summary without throwing (Requirements 7.3, 7.6)', () => {
    const empty: EvidenceSummary = {
      change: { files: [] },
      claim: { status: 'not_identified' },
      subject: { url: '' },
      actions: [],
      observations: [],
      artifacts: { runDir: '', reportPath: '' },
    };
    expect(satisfiesMinimumEvidence(empty)).toBe(false);
  });
});
