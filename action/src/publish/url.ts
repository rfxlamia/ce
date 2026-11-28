/**
 * Image_URL builder and parser (Requirement 6, 9.5).
 *
 * The implementation lives in `packages/ce/src/evidence/image-url.ts` because
 * the Comment_Renderer must re-validate URLs and `packages/ce` cannot import
 * from `action/`. This module re-exports it for the Publisher.
 */
export { buildImageUrl, parseImageUrl, serverUrlFromEnv, DEFAULT_SERVER_URL } from 'continuous-evidence';
export type { ImageUrlParts, ExpectedImageContext, ParsedImageUrl } from 'continuous-evidence';
