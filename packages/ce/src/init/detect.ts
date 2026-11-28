// Project detection for `ce init`.
// Pure function of its arguments: no fs, no process.*, returns data only (never YAML text).

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface DetectInput {
  /** Raw package.json text, or null when it is missing or unreadable. */
  packageJsonText: string | null;
  /** Entry names in the cwd that matter (lockfiles). */
  files: ReadonlySet<string>;
}

export type Detection =
  | {
      status: 'detected';
      pm: PackageManager;
      pmMajor: number | null;
      script: 'dev' | 'start';
      port: number;
      portSource: 'explicit' | 'framework' | 'unknown';
      framework: string | null;
      hasLockfile: boolean;
      ceInstalled: boolean;
      /** Raw, user-controlled script text. Sanitising it before it reaches a comment is the template's job. */
      scriptText: string;
    }
  | {
      status: 'fallback';
      reason: 'missing' | 'unparseable' | 'not-object' | 'no-script';
      pm: PackageManager;
      pmMajor: number | null;
      hasLockfile: boolean;
      ceInstalled: boolean;
    };

const FRAMEWORK_PORTS: Record<string, number> = { vite: 5173 };

export function detectProject(input: DetectInput): Detection {
  const pkg = JSON.parse(input.packageJsonText ?? '{}') as Record<string, unknown>;
  const scripts = pkg.scripts as Record<string, string>;
  const scriptText = scripts.dev;
  const devDeps = pkg.devDependencies as Record<string, unknown>;
  const framework = Object.keys(FRAMEWORK_PORTS).find((name) => name in devDeps) ?? null;
  return {
    status: 'detected',
    pm: 'npm',
    pmMajor: null,
    script: 'dev',
    port: framework ? FRAMEWORK_PORTS[framework]! : 3000,
    portSource: framework ? 'framework' : 'unknown',
    framework,
    hasLockfile: input.files.has('package-lock.json'),
    ceInstalled: false,
    scriptText,
  };
}
