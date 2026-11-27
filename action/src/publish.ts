export type PublishMode = 'none';

/**
 * Validates the `publish` input before any other side effect.
 *
 * An empty value maps to `none`. `branch` is recognised but not implemented
 * in this release. Any other value is rejected. Throws on every value except
 * empty and `none`.
 */
export function validatePublishMode(raw: string): PublishMode {
  if (raw === '' || raw === 'none') return 'none';
  if (raw === 'branch') {
    throw new Error(
      'publish: branch is not implemented in this release. See the follow-up issue for `publish: branch` (rfxlamia/ce).',
    );
  }
  throw new Error(
    `publish: invalid value. Allowed values are "none" and "branch".`,
  );
}
