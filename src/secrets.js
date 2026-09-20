/**
 * Credential checks and redaction. Never log or return MERCURY_API_TOKEN.
 */

export const REQUIRED_TOKEN_VAR = "MERCURY_API_TOKEN";
export const OFORICA_TOKEN_ALIAS_VAR = "OFORICA_MERCURY_API_TOKEN";
export const TOKEN_PREFIX = "secret-token:";

const SENSITIVE_ENV_KEYS = [REQUIRED_TOKEN_VAR];

const CREDENTIAL_ASSIGNMENT =
  /(?:mercury_api_token|api[_-]?token|authorization|secret-token)\s*[=:]\s*["']?[^"'\s,}\\]+/gi;
const BEARER = /Bearer\s+\S+/gi;
const SECRET_TOKEN = /secret-token:[^\s"'\\]+/gi;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function missingTokenVars(env = process.env) {
  return String(env[REQUIRED_TOKEN_VAR] || "").trim()
    ? []
    : [REQUIRED_TOKEN_VAR];
}

/**
 * Ori / Grok Bot: map OFORICA_MERCURY_API_TOKEN → MERCURY_API_TOKEN.
 * Never logs values. Does not overwrite an already-set MERCURY_API_TOKEN.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
export function applyOforicaTokenAlias(env = process.env) {
  const next = { ...env };
  if (
    !String(next[REQUIRED_TOKEN_VAR] || "").trim() &&
    String(next[OFORICA_TOKEN_ALIAS_VAR] || "").trim()
  ) {
    next[REQUIRED_TOKEN_VAR] = next[OFORICA_TOKEN_ALIAS_VAR];
  }
  return next;
}

/**
 * Mercury dashboard tokens include the `secret-token:` prefix. If the stored
 * value is missing it, add it so Authorization is always
 * `Bearer secret-token:…`.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeApiToken(raw) {
  const token = String(raw || "").trim();
  if (!token) {
    throw new Error(
      "MERCURY_API_TOKEN is not set. Set it in Cursor → Plugins → Configure. Do not pass secrets on the command line."
    );
  }
  return token.startsWith(TOKEN_PREFIX) ? token : `${TOKEN_PREFIX}${token}`;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function requireApiToken(env = process.env) {
  const missing = missingTokenVars(env);
  if (missing.length > 0) {
    throw new Error(
      "Missing required configuration: MERCURY_API_TOKEN. Set it in Cursor → Plugins → Configure. Do not pass secrets on the command line."
    );
  }
  return normalizeApiToken(env[REQUIRED_TOKEN_VAR]);
}

/**
 * Strip known secret values and credential-shaped substrings from an error.
 * @param {unknown} err
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function safeErrorMessage(err, env = process.env) {
  let msg = err instanceof Error ? err.message : String(err);
  for (const key of SENSITIVE_ENV_KEYS) {
    const val = env[key];
    if (val && String(val).length > 0) {
      msg = msg.split(String(val)).join(`[${key}]`);
      const normalized = normalizeApiTokenSafe(val);
      if (normalized && normalized !== String(val)) {
        msg = msg.split(normalized).join(`[${key}]`);
      }
    }
  }
  msg = msg.replace(CREDENTIAL_ASSIGNMENT, "[redacted-credential]");
  msg = msg.replace(BEARER, "Bearer [redacted]");
  msg = msg.replace(SECRET_TOKEN, "secret-token:[redacted]");
  return msg;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeApiTokenSafe(raw) {
  const token = String(raw || "").trim();
  if (!token) return "";
  return token.startsWith(TOKEN_PREFIX) ? token : `${TOKEN_PREFIX}${token}`;
}
