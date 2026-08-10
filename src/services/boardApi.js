// REST + WebSocket helpers for the whiteboard backend.
//
// The HTTP client supports:
//   - AbortSignal passthrough (every call can be cancelled)
//   - per-request timeout via AbortSignal.timeout
//   - automatic retries with exponential backoff for idempotent
//     (safe) methods on transient failures
//   - structured errors that callers can branch on

import { env } from "../config/env.js";

const DEFAULT_HEADERS = { "Content-Type": "application/json" };

/**
 * @typedef {Error & { status?: number, body?: string, isAbort?: boolean }} HttpError
 */

const buildHttpError = (status, body) => {
  const err = new Error(body || `Request failed with status ${status}`);
  err.status = status;
  err.body = body;
  err.name = "HttpError";
  return err;
};

const isTransient = (status) => status === undefined || status >= 500 || status === 408 || status === 429;

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true }
    );
  });

const abortError = () => {
  const e = new Error("aborted");
  e.isAbort = true;
  e.name = "AbortError";
  return e;
};

const combineSignals = (timeoutMs, external) => {
  if (!timeoutMs) return external ?? null;
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  return AbortSignal.any([external, timeout]);
};

/**
 * Low-level request helper. Callers usually want the named helpers
 * below; this is exposed for tests and unusual cases.
 *
 * @param {string} path
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.headers]
 * @param {object} [options.body]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries]
 */
export async function request(path, options = {}) {
  const { method = "GET", headers, body, signal, timeoutMs, retries } = options;
  const maxRetries = retries ?? env.apiMaxRetries;
  const url = `${env.apiBaseUrl}${path}`;

  let attempt = 0;
  // The first error we hit is preserved so callers see the original cause.
  let lastError;

  while (attempt <= maxRetries) {
    const perAttemptSignal = combineSignals(timeoutMs, signal);
    try {
      const response = await fetch(url, {
        method,
        headers: { ...DEFAULT_HEADERS, ...(headers || {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: perAttemptSignal
      });

      if (!response.ok) {
        const text = await safeReadText(response);
        if (isTransient(response.status) && attempt < maxRetries) {
          lastError = buildHttpError(response.status, text);
          attempt += 1;
          await sleep(backoffMs(attempt), signal);
          continue;
        }
        throw buildHttpError(response.status, text);
      }

      if (response.status === 204) return null;
      const text = await safeReadText(response);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      // If the caller cancelled, propagate immediately.
      if (err?.isAbort || err?.name === "AbortError") throw err;
      lastError = err;
      // Only retry on transient network errors.
      const transient = err instanceof TypeError || isTransient(err?.status);
      if (!transient || attempt >= maxRetries) throw err;
      attempt += 1;
      await sleep(backoffMs(attempt), signal);
    }
  }
  throw lastError ?? new Error("request failed");
}

const backoffMs = (attempt) => {
  // 200ms, 400ms, 800ms, ... with full jitter so a thundering herd
  // doesn't reconnect in lockstep.
  const base = 200 * 2 ** (attempt - 1);
  return Math.floor(Math.random() * base);
};

const safeReadText = async (response) => {
  try {
    return await response.text();
  } catch {
    return "";
  }
};

// --- Board API ----------------------------------------------------------

export function createBoard(title, options) {
  return request("/api/boards", { method: "POST", body: { title }, ...options });
}

export function getBoards(options) {
  return request("/api/boards", options);
}

export function getBoard(boardId, options) {
  return request(`/api/boards/${encodeURIComponent(boardId)}`, options);
}

export function updateBoardTitle(boardId, title, options) {
  return request(`/api/boards/${encodeURIComponent(boardId)}`, {
    method: "PATCH",
    body: { title },
    ...options
  });
}

export function addBoardPage(boardId, name, options) {
  return request(`/api/boards/${encodeURIComponent(boardId)}/pages`, {
    method: "POST",
    body: { name },
    ...options
  });
}

export function deleteBoard(boardId, options) {
  return request(`/api/boards/${encodeURIComponent(boardId)}`, { method: "DELETE", ...options });
}

/**
 * Synchronously persist a page's full element list via REST (PUT).
 * Use this for operations that must be durable (erase, clear) since it
 * avoids the async WebSocket goroutine race in the backend.
 *
 * Returns null on success (204 No Content) or throws on error.
 */
export function savePageElements(boardId, pageId, elements, options) {
  return request(
    `/api/boards/${encodeURIComponent(boardId)}/pages/${encodeURIComponent(pageId)}/elements`,
    { method: "PUT", body: elements, ...options }
  );
}

export function getBoardEventsAfter(boardId, afterCursor = 0, options) {
  const cursor = Number.isFinite(afterCursor) ? afterCursor : 0;
  return request(`/api/boards/${encodeURIComponent(boardId)}/events?after=${cursor}`, options);
}

/**
 * Returns a human-readable description of where the API is being
 * served from. Safe to render inside tooltips and badges.
 */
export function getApiBaseUrl() {
  return env.apiBaseUrl || "same-origin /api proxy";
}

/**
 * Build the websocket URL for a given board. Honors the configured
 * API base URL; falls back to the current origin when none is set.
 *
 * @param {string} boardId
 * @param {number} [cursor]
 */
export function getWebSocketUrl(boardId, cursor = 0) {
  if (!boardId) return null;
  const safeCursor = Number.isFinite(cursor) && cursor > 0 ? cursor : 0;
  const cursorQuery = safeCursor ? `?cursor=${safeCursor}` : "";

  if (env.apiBaseUrl) {
    // Only swap the scheme. Anything else (host:port, path prefix)
    // is left alone, so the URL works behind path-based proxies.
    const wsBase = env.apiBaseUrl.replace(/^http(s)?:\/\//, (_, s) => `ws${s ? "s" : ""}://`);
    return `${wsBase}/ws/boards/${encodeURIComponent(boardId)}/join${cursorQuery}`;
  }
  const loc = typeof window !== "undefined" ? window.location : null;
  if (!loc) return null;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/ws/boards/${encodeURIComponent(boardId)}/join${cursorQuery}`;
}
