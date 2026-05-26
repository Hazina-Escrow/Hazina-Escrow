/**
 * Environment variable validation.
 *
 * Call validateEnv() once at app startup (main.tsx) so missing or
 * invalid env vars fail loudly instead of causing cryptic runtime errors.
 */

interface EnvConfig {
  apiUrl: string;
  enableDemoMode: boolean;
}

const REQUIRED_ENV_VARS = ["VITE_API_URL"] as const;

function readEnableDemoMode() {
  return String(import.meta.env.VITE_ENABLE_DEMO_MODE ?? "")
    .trim()
    .toLowerCase() === "true";
}

/**
 * Validate required environment variables and return a typed config object.
 * Throws a descriptive error when a required variable is missing or empty.
 */
export function validateEnv(): EnvConfig {
  const missing: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    const value = import.meta.env[key];
    if (!value || String(value).trim() === "") {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const list = missing.map((k) => `  • ${k}`).join("\n");
    throw new Error(
      `[Hazina] Missing required environment variable(s):\n${list}\n\n` +
        "Copy .env.example to .env and fill in the missing values before starting the app.",
    );
  }

  return {
    apiUrl: String(import.meta.env.VITE_API_URL).trim().replace(/\/+$/, ""),
    enableDemoMode: readEnableDemoMode(),
  };
}

/**
 * Validated env config — available after validateEnv() succeeds.
 * Import this anywhere you need typed access to env values.
 */
let _env: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!_env) {
    throw new Error(
      "[Hazina] getEnv() called before validateEnv(). " +
        "Make sure validateEnv() is called in main.tsx before rendering the app.",
    );
  }
  return _env;
}

export function initEnv(): EnvConfig {
  _env = validateEnv();
  return _env;
}

export function isDemoModeEnabled() {
  return readEnableDemoMode();
}
