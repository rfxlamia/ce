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

const DEFAULT_PORT = 3000;

interface FrameworkEntry {
  name: string;
  port: number;
  /** Command tokens that identify this framework in a script. */
  commands: readonly string[];
  /** Dependency names that identify this framework. */
  deps: readonly string[];
}

const FRAMEWORKS: readonly FrameworkEntry[] = [
  { name: 'vite', port: 5173, commands: ['vite'], deps: ['vite'] },
  { name: '@sveltejs/kit', port: 5173, commands: [], deps: ['@sveltejs/kit'] },
  { name: 'next', port: 3000, commands: ['next'], deps: ['next'] },
  { name: 'nuxt', port: 3000, commands: ['nuxt'], deps: ['nuxt'] },
  { name: 'nuxi', port: 3000, commands: ['nuxi'], deps: ['nuxi'] },
  { name: 'astro', port: 4321, commands: ['astro'], deps: ['astro'] },
  { name: '@angular/cli', port: 4200, commands: ['ng'], deps: ['@angular/cli'] },
  { name: 'react-scripts', port: 3000, commands: ['react-scripts'], deps: ['react-scripts'] },
  { name: 'gatsby', port: 8000, commands: ['gatsby'], deps: ['gatsby'] },
];

const VALUE = '([^\\s;&|]+)';
const PORT_PATTERNS: readonly RegExp[] = [
  new RegExp(`(?:^|[\\s;&|])--port(?:=|\\s+)${VALUE}`, 'g'),
  new RegExp(`(?:^|[\\s;&|])-p\\s+${VALUE}`, 'g'),
  new RegExp(`(?:^|[\\s;&|])PORT=${VALUE}`, 'g'),
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validPort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

/** Earliest valid explicit port across all patterns; invalid matches are ignored. */
function explicitPort(script: string): number | null {
  const matches: { index: number; value: string }[] = [];
  for (const pattern of PORT_PATTERNS) {
    for (const m of script.matchAll(pattern)) {
      matches.push({ index: m.index ?? 0, value: m[1] ?? '' });
    }
  }
  matches.sort((a, b) => a.index - b.index);
  for (const { value } of matches) {
    const port = validPort(value);
    if (port !== null) return port;
  }
  return null;
}

function scriptTokens(script: string): string[] {
  return script
    .split(/[\s;&|()]+/)
    .filter(Boolean)
    .map((t) => t.slice(t.lastIndexOf('/') + 1));
}

function detectFramework(script: string, depNames: ReadonlySet<string>): FrameworkEntry | null {
  const tokens = new Set(scriptTokens(script));
  return (
    FRAMEWORKS.find((f) => f.commands.some((c) => tokens.has(c))) ??
    FRAMEWORKS.find((f) => f.deps.some((d) => depNames.has(d))) ??
    null
  );
}

const PM_NAMES: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

function usableScript(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function packageManagerField(value: unknown): { pm: PackageManager; pmMajor: number | null } | null {
  if (typeof value !== 'string') return null;
  const m = /^([a-z]+)(?:@(.*))?$/.exec(value);
  const name = PM_NAMES.find((n) => n === m?.[1]);
  if (!name) return null;
  const major = /^(\d+)/.exec(m?.[2] ?? '');
  return { pm: name, pmMajor: major ? Number(major[1]) : null };
}

function pmFromLockfiles(files: ReadonlySet<string>): PackageManager {
  if (files.has('pnpm-lock.yaml')) return 'pnpm';
  if (files.has('yarn.lock')) return 'yarn';
  if (files.has('bun.lock') || files.has('bun.lockb')) return 'bun';
  return 'npm';
}

const LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json'];

export function detectProject(input: DetectInput): Detection {
  const pkg = JSON.parse(input.packageJsonText ?? '{}') as Record<string, unknown>;
  const scripts = (isRecord(pkg.scripts) ? pkg.scripts : {}) as Record<string, unknown>;
  const dev = scripts.dev;
  const start = scripts.start;
  const script: 'dev' | 'start' = usableScript(dev) ? 'dev' : 'start';
  const scriptText = (usableScript(dev) ? dev : start) as string;

  const deps = isRecord(pkg.dependencies) ? pkg.dependencies : {};
  const devDeps = isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
  const depNames = new Set([...Object.keys(deps), ...Object.keys(devDeps)]);

  const explicit = explicitPort(scriptText);
  const fw = detectFramework(scriptText, depNames);
  const port = explicit ?? fw?.port ?? DEFAULT_PORT;
  const portSource = explicit !== null ? 'explicit' : fw ? 'framework' : 'unknown';
  const declared = packageManagerField(pkg.packageManager);

  return {
    status: 'detected',
    pm: declared?.pm ?? pmFromLockfiles(input.files),
    pmMajor: declared?.pmMajor ?? null,
    script,
    port,
    portSource,
    framework: fw?.name ?? null,
    hasLockfile: LOCKFILES.some((f) => input.files.has(f)),
    ceInstalled: depNames.has('continuous-evidence'),
    scriptText,
  };
}
