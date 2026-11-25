import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

/** Default .env location: repository root (spike/jev-openrouter/lib -> ../../..). */
export const DEFAULT_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url));

export interface EnvDeps {
  /** Path to the dotenv file. Injectable so tests never touch the real .env. */
  envPath?: string;
  /** Target environment. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Exit function. Defaults to process.exit. */
  exit?: (code: number) => never;
  /** Message sink. Defaults to console.error. Receives variable names only, never values. */
  log?: (message: string) => void;
}

export interface EnvStatus {
  openrouterKeyPresent: boolean;
  typesafeKeyPresent: boolean;
}

const isSet = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * Load .env without overriding variables already set. A missing file is not an error.
 * Exits (and sends nothing) when OPENROUTER_API_KEY is unset; reports TYPESAFE_API_KEY absence without failing.
 */
export function loadEnv(deps: EnvDeps = {}): EnvStatus {
  const env = deps.env ?? process.env;
  const exit = deps.exit ?? ((code: number): never => process.exit(code));
  const log = deps.log ?? ((m: string) => console.error(m));

  // dotenv returns { error } for a missing file instead of throwing.
  loadDotenv({
    path: deps.envPath ?? DEFAULT_ENV_PATH,
    processEnv: env as Record<string, string>,
    override: false,
    quiet: true,
  });

  const openrouterKeyPresent = isSet(env.OPENROUTER_API_KEY);
  const typesafeKeyPresent = isSet(env.TYPESAFE_API_KEY);

  if (!openrouterKeyPresent) {
    log('OPENROUTER_API_KEY is not set (checked process environment and .env). No request was sent.');
    return exit(1);
  }
  if (!typesafeKeyPresent) {
    log('TYPESAFE_API_KEY is not set; checks using the typesafe provider will be skipped.');
  }
  return { openrouterKeyPresent, typesafeKeyPresent };
}
