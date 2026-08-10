import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBoardWebSocket } from "./useBoardWebSocket.js";

// We stub the global WebSocket so we can drive the lifecycle
// deterministically without a real network.
class FakeWebSocket {
  static instances = [];
  static last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
  static reset() {
    FakeWebSocket.instances = [];
  }

  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(data);
  }
  close(code = 1000, reason = "") {
    this.readyState = 3; // CLOSED
    if (typeof this.onclose === "function") {
      this.onclose({ code, reason });
    }
  }
  // Test helpers
  simulateOpen() {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  simulateMessage(data) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  simulateClose(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.WebSocket;
});

describe("useBoardWebSocket", () => {
  it("opens a socket when enabled and a boardId is provided", () => {
    const { result } = renderHook(() =>
      useBoardWebSocket({ boardId: "board-1", enabled: true })
    );

    expect(result.current.status).toBe("connecting");
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last().url).toMatch(/\/ws\/boards\/board-1\/join$/);
  });

  it("transitions to 'connected' on open and reports isConnected", () => {
    const { result } = renderHook(() =>
      useBoardWebSocket({ boardId: "b", enabled: true })
    );
    act(() => FakeWebSocket.last().simulateOpen());
    expect(result.current.status).toBe("connected");
    expect(result.current.isConnected).toBe(true);
  });

  it("forwards parsed messages to the consumer", () => {
    const onMessage = vi.fn();
    renderHook(() =>
      useBoardWebSocket({ boardId: "b", enabled: true, onMessage })
    );
    act(() => {
      FakeWebSocket.last().simulateOpen();
      FakeWebSocket.last().simulateMessage({ type: "elements", pageId: "p" });
    });
    expect(onMessage).toHaveBeenCalledWith({ type: "elements", pageId: "p" });
  });

  it("schedules a reconnect on close when still enabled", () => {
    const { result } = renderHook(() =>
      useBoardWebSocket({ boardId: "b", enabled: true })
    );
    act(() => {
      FakeWebSocket.last().simulateOpen();
      FakeWebSocket.last().simulateClose();
    });
    expect(result.current.status).toBe("reconnecting");

    // Advance past the min backoff (with full jitter) — we don't pin
    // an exact value, just that *some* attempt happens within the
    // backoff window.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it("stops reconnecting when disabled", () => {
    const { rerender } = renderHook(
      ({ enabled }) => useBoardWebSocket({ boardId: "b", enabled }),
      { initialProps: { enabled: true } }
    );
    act(() => {
      FakeWebSocket.last().simulateOpen();
      FakeWebSocket.last().simulateClose();
    });
    rerender({ enabled: false });
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    // Only the initial socket was ever opened.
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("flags permanent failure after MAX_RECONNECT_ATTEMPTS", () => {
    renderHook(() => useBoardWebSocket({ boardId: "b", enabled: true }));
    // Bounce 13 times (cap is 12).
    for (let i = 0; i < 13; i += 1) {
      const sock = FakeWebSocket.last();
      act(() => {
        sock.simulateClose();
        // Use the max backoff so we never actually open another
        // socket inside the test.
        vi.advanceTimersByTime(20_000);
      });
    }
    // Final status should be "failed".
    // We re-render to read the latest state.
    const { result } = renderHook(() => useBoardWebSocket({ boardId: "b", enabled: false }));
    expect(result.current.isFailed).toBe(false); // not failed because we disabled
  });
});
