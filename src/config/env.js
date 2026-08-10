// Centralized, validated access to the build-time env.
// Throws at import time if anything is malformed so the app fails
// loudly instead of silently picking up a fallback at runtime.

const requiredString = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
};

const requiredNumber = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = value === undefined || value === null ? "" : String(value).trim();
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`env: expected number in [${min}, ${max}], got ${raw}`);
  }
  return n;
};

const requiredBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error(`env: expected boolean, got ${value}`);
};

const apiBaseUrl = requiredString(import.meta.env.VITE_API_BASE_URL, "");

export const env = Object.freeze({
  apiBaseUrl,
  apiTimeoutMs: requiredNumber(import.meta.env.VITE_API_TIMEOUT_MS, 15_000, { min: 1000 }),
  apiMaxRetries: requiredNumber(import.meta.env.VITE_API_MAX_RETRIES, 2, { min: 0, max: 6 }),
  wsReconnectMinMs: requiredNumber(import.meta.env.VITE_WS_RECONNECT_MIN_MS, 1_000, { min: 100 }),
  wsReconnectMaxMs: requiredNumber(import.meta.env.VITE_WS_RECONNECT_MAX_MS, 15_000, { min: 1000 }),
  wsPauseOnHidden: requiredBoolean(import.meta.env.VITE_WS_PAUSE_ON_HIDDEN, true),
});

// One-shot sanity check at import. The main thing we want to guard
// against is a misconfigured reconnect window.
if (env.wsReconnectMinMs > env.wsReconnectMaxMs) {
  throw new Error(
    `env: VITE_WS_RECONNECT_MIN_MS (${env.wsReconnectMinMs}) must be <= VITE_WS_RECONNECT_MAX_MS (${env.wsReconnectMaxMs})`
  );
}
