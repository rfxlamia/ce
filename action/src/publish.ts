import { loadConfig } from 'continuous-evidence';

export type PublishMode = 'none' | 'branch';

/**
 * Validates the `publish` input before any other side effect.
 *
 * An empty value maps to `none`. `none` and `branch` are accepted. Any other
 * value is rejected with a message that lists the two allowed values.
 */
export function validatePublishMode(raw: string): PublishMode {
  if (raw === '' || raw === 'none') return 'none';
  if (raw === 'branch') return 'branch';
  throw new Error(`publish: invalid value. Allowed values are "none" and "branch".`);
}

export const DEFAULT_PUBLISH_MAX_IMAGES = 6;
export const DEFAULT_PUBLISH_MAX_IMAGE_BYTES = 5242880;

export interface PublishSettings {
  mode: PublishMode;
  maxImages: number;
  maxImageBytes: number;
}

/**
 * Reads the effective publish settings through `loadConfig`, so the precedence is
 * Action input and environment, then `ce.yml`, then the defaults (Requirement 1.2).
 * When the configuration does not load, the CE_CLI reports that error itself and the
 * settings fall back to the validated input mode with the default caps.
 */
export function resolvePublishSettings(
  options: {
    cwd: string;
    flags: Record<string, unknown>;
    env: Record<string, string | undefined>;
  },
  inputMode: PublishMode,
): PublishSettings {
  try {
    const loaded = loadConfig(options);
    if (loaded.ok) {
      return {
        mode: loaded.config.publish ?? 'none',
        maxImages: loaded.config['publish-max-images'] ?? DEFAULT_PUBLISH_MAX_IMAGES,
        maxImageBytes: loaded.config['publish-max-image-bytes'] ?? DEFAULT_PUBLISH_MAX_IMAGE_BYTES,
      };
    }
  } catch {
    // fall through to the input value
  }
  return {
    mode: inputMode,
    maxImages: DEFAULT_PUBLISH_MAX_IMAGES,
    maxImageBytes: DEFAULT_PUBLISH_MAX_IMAGE_BYTES,
  };
}
