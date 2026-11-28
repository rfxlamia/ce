/**
 * Image_URL builder and parser (Requirement 6, 9.5).
 * Pure; shared by the Publisher (action/) and the Comment_Renderer.
 *
 * Form: `${serverUrl}/${owner}/${repo}/raw/${sha}/pr-${n}/${runId}/${file}`.
 * The URL names a commit SHA, never the branch, so its content is immutable.
 */

export interface ImageUrlParts {
  /** e.g. `https://github.com`; taken from GITHUB_SERVER_URL by the caller. */
  serverUrl: string;
  owner: string;
  repo: string;
  /** Full 40-character lowercase hexadecimal commit SHA. */
  sha: string;
  /** Positive integer pull request number. */
  prNumber: number;
  /** The Run_Id directory name. */
  runId: string;
  /** The published file name, e.g. `final.png`. */
  file: string;
}

export interface ExpectedImageContext {
  serverUrl: string;
  owner: string;
  repo: string;
  prNumber: number;
}

export type ParsedImageUrl = Pick<ImageUrlParts, 'sha' | 'runId' | 'file'>;

export const DEFAULT_SERVER_URL = 'https://github.com';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
/** Characters a valid Image_URL may contain (Requirement 9.5). */
const ALLOWED_URL_CHARS = /^[A-Za-z0-9._~%/:-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

function isSafeSegment(segment: string): boolean {
  return (
    segment !== '' &&
    segment !== '.' &&
    !segment.includes('/') &&
    !segment.includes('..') &&
    !CONTROL_CHARS.test(segment)
  );
}

/** encodeURIComponent leaves `!'()*` alone; encode them too so the output stays inside the allowed set. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function trimServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

/** Resolves the server URL from the environment, defaulting to github.com (GHES support). */
export function serverUrlFromEnv(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env['GITHUB_SERVER_URL'];
  return raw !== undefined && raw !== '' ? raw : DEFAULT_SERVER_URL;
}

/** Throws when sha, prNumber, runId, or file is invalid (Requirement 6.3). */
export function buildImageUrl(parts: ImageUrlParts): string {
  if (!SHA_PATTERN.test(parts.sha)) {
    throw new Error('Image URL: sha must be 40 lowercase hexadecimal characters.');
  }
  if (!Number.isInteger(parts.prNumber) || parts.prNumber <= 0) {
    throw new Error('Image URL: pull request number must be a positive integer.');
  }
  if (!isSafeSegment(parts.runId)) {
    throw new Error('Image URL: run id is not a valid path segment.');
  }
  if (!isSafeSegment(parts.file)) {
    throw new Error('Image URL: file name is not a valid path segment.');
  }
  return (
    `${trimServerUrl(parts.serverUrl)}/${parts.owner}/${parts.repo}/raw/${parts.sha}` +
    `/pr-${parts.prNumber}/${encodeSegment(parts.runId)}/${encodeSegment(parts.file)}`
  );
}

/**
 * Returns the sha, run id, and file when `url` is exactly the canonical URL for
 * the expected server, owner, repo, and PR number; otherwise `undefined`.
 */
export function parseImageUrl(url: string, expected: ExpectedImageContext): ParsedImageUrl | undefined {
  if (typeof url !== 'string' || !ALLOWED_URL_CHARS.test(url)) return undefined;
  if (!Number.isInteger(expected.prNumber) || expected.prNumber <= 0) return undefined;

  const prefix = `${trimServerUrl(expected.serverUrl)}/${expected.owner}/${expected.repo}/raw/`;
  if (!url.startsWith(prefix)) return undefined;

  const segments = url.slice(prefix.length).split('/');
  if (segments.length !== 4) return undefined;
  const [sha, prSegment, encodedRunId, encodedFile] = segments as [string, string, string, string];
  if (!SHA_PATTERN.test(sha)) return undefined;
  if (prSegment !== `pr-${expected.prNumber}`) return undefined;

  let runId: string;
  let file: string;
  try {
    runId = decodeURIComponent(encodedRunId);
    file = decodeURIComponent(encodedFile);
  } catch {
    return undefined;
  }

  // Re-build and compare: rejects non-canonical encodings and unsafe segments.
  let rebuilt: string;
  try {
    rebuilt = buildImageUrl({ ...expected, sha, runId, file });
  } catch {
    return undefined;
  }
  if (rebuilt !== url) return undefined;

  return { sha, runId, file };
}
