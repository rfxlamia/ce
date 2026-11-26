// Public surface of the Context Resolver, for the Assessment stage and `ce run`.
// Nothing from jev/ is re-exported here.

export { resolveContext } from './resolve.js';
export type { ResolveContextOptions } from './resolve.js';

export type {
  BudgetedChangeContext,
  ChangeContext,
  ChangedFile,
  ClaimCandidate,
  Provenance,
  RawChangeContext,
  ReasonCode,
  TruncationReason,
} from './types.js';

export {
  CONTEXT_BUDGET_TOKENS,
  REQUEST_HEADROOM_TOKENS,
  STATE_BUDGET_TOKENS,
  estimateTokens,
  estimateTokensOf,
  fitCheckResults,
  isTestFile,
  truncateToTokens,
} from './budget.js';
