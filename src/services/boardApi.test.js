import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We import env first so the env-validation runs once. Tests below
// mutate import.meta.env via the mocked Vite env at module top level.
import { env } from "../config/env.js";
import { getWebSocketUrl, request } from "./boardApi.js";

const originalFetch = globalThis.fetch;

describe("request()", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("sends a JSON body and decodes the response", async () => {
    /** @type {any} */
    let captured;
    globalThis.fetch = vi.fn(async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await request("/api/boards", { method: "POST", body: { title: "hi" } });
    expect(result).toEqual({ ok: true });
    expect(captured.url).toBe(`${env.apiBaseUrl}/api/boards`);
    expect(captured.init.method).toBe("POST");
    expect(JSON.parse(captured.init.body)).toEqual({ title: "hi" });
  });

  it("returns null for 204 responses", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await request("/api/boards/x", { method: "DELETE" });
    expect(result).toBeNull();
  });

  it("throws an HttpError with status and body for 4xx without retrying", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 400 }));
    globalThis.fetch = fetchMock;

    await expect(request("/api/boards", { method: "POST" })).rejects.toMatchObject({
      status: 400,
      body: "nope",
      name: "HttpError"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx up to apiMaxRetries and then throws", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    globalThis.fetch = fetchMock;

    await expect(
      request("/api/boards", { method: "GET", retries: 2 })
    ).rejects.toMatchObject({ status: 500 });
    // 1 initial + 2 retries = 3
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries on network errors (TypeError)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    globalThis.fetch = fetchMock;

    await expect(
      request("/api/boards", { method: "GET", retries: 1 })
    ).rejects.toThrow(/network down/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts when the caller's signal fires", async () => {
    const ac = new AbortController();
    globalThis.fetch = vi.fn(async (url, init) => {
      // Simulate fetch honouring the signal.
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });
    const p = request("/api/boards", { signal: ac.signal });
    ac.abort();
    // The original AbortError from fetch is re-thrown as-is.
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("getWebSocketUrl()", () => {
  it("returns null for a missing boardId", () => {
    expect(getWebSocketUrl("")).toBeNull();
  });

  it("encodes the boardId and includes a non-zero cursor", () => {
    const url = getWebSocketUrl("abc 123/=", 7);
    expect(url).toMatch(/\/ws\/boards\/abc%20123%2F%3D\/join\?cursor=7$/);
  });

  it("omits the cursor query when cursor is 0", () => {
    const url = getWebSocketUrl("board");
    expect(url).toMatch(/\/ws\/boards\/board\/join$/);
  });
});
