// Artifact naming and link building (Requirement 7.2, 7.4, 7.5, 7.6).
// Pure functions only. The upload itself is done by the adapters in github.ts.

/** Characters GitHub forbids in an artifact name: " : < > | * ? \ / CR LF. */
const FORBIDDEN_NAME_CHARS = /["\u003A<>|*?\\/\r\n]/g;

/**
 * Replaces every character GitHub forbids in an artifact name with '-'.
 * The result has the same length as the input (Requirement 7.2).
 */
export function sanitizeArtifactNamePart(part: string): string {
  return part.replace(FORBIDDEN_NAME_CHARS, '-');
}

export interface ArtifactNameInput {
  /** The `artifact-name` input, '' when unset. */
  explicitName: string;
  runId: string;
  runAttempt: string;
  job: string;
  /** Directory name of the Run_Dir (`run-<iso>`). */
  runDirName: string;
}

/**
 * A non-empty explicit name is used, sanitized, as the whole name. Otherwise
 * `ce-evidence-<runId>-<runAttempt>-<job>-<runDirName>`, each part sanitized
 * before joining (Requirement 7.2).
 */
export function buildArtifactName(input: ArtifactNameInput): string {
  if (input.explicitName !== '') {
    return sanitizeArtifactNamePart(input.explicitName);
  }
  return [
    'ce-evidence',
    input.runId,
    input.runAttempt,
    input.job,
    input.runDirName,
  ]
    .map(sanitizeArtifactNamePart)
    .join('-');
}

export interface ArtifactLinkInput {
  serverUrl: string;
  /** `owner/name`. */
  repository: string;
  runId: string;
  /** Result of the upload. `undefined` when the upload failed. */
  upload: { id?: number | string } | undefined;
}

/**
 * Artifact_Link: the artifact URL when the upload returned an id (7.4), the
 * workflow run URL when it returned none (7.5), and '' when the upload failed (7.6).
 */
export function buildArtifactLink(input: ArtifactLinkInput): string {
  if (input.upload === undefined) return '';
  const base = input.serverUrl.replace(/\/+$/, '');
  const runUrl = `${base}/${input.repository}/actions/runs/${input.runId}`;
  const id = input.upload.id;
  if (id === undefined || id === null || id === '') return runUrl;
  return `${runUrl}/artifacts/${id}`;
}
