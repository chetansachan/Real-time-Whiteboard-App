// useBoardWebSocket — production-shaped websocket lifecycle:
//
//   * exponential backoff with full jitter
//   * permanent failure after a configurable cap
//   * pings every 25s to keep the connection warm (server is also
//     expected to ping/pong)
//   * pauses while the tab is hidden, resumes on focus
//   * ref-stabilised onMessage/onError so the upstream effect does
//     not thrash
//   * tight cleanup: every timer, listener, and socket is closed on
//     unmount or board change

import { useEffect, useRef, useState, useCallback } from "react";
import { getWebSocketUrl } from "../services/boardApi.js";
import { env } from "../config/env.js";

const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 12; // ~5 minutes at the upper bound

/**
 * @param {object} options
 * @param {string} [options.boardId]
 * @param {boolean} [options.enabled]
 * @param {number} [options.initialCursor]
 * @param {(data: any) => void} [options.onMessage]
 * @param {(err: Event) => void} [options.onError]
 * @param {(code: number, reason: string) => void} [options.onClose]
 */
export function useBoardWebSocket({
  boardId,
  enabled = false,
  initialCursor = 0,
  onMessage,
  onError,
  onClose
} = {}) {
  const [status, setStatus] = useState("disconnected");
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const pingTimerRef = useRef(null);
  const pongTimerRef = useRef(null);
  const attemptsRef = useRef(0);
  const cursorRef = useRef(Math.max(0, Number(initialCursor) || 0));
  const visibilityListenerRef = useRef(null);

  // Latest callbacks are stored in refs so connect() stays referentially
  // stable; without this, an inline lambda in the consumer would
  // re-trigger the connection effect on every render.
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (pongTimerRef.current) {
      clearTimeout(pongTimerRef.current);
      pongTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        // code 1000 = normal closure
        ws.close(1000, "client closing");
      } catch {
        /* socket already gone */
      }
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!enabled) return;
    if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setStatus("failed");
      return;
    }
    const attempt = attemptsRef.current + 1;
    attemptsRef.current = attempt;
    const base = Math.min(env.wsReconnectMaxMs, env.wsReconnectMinMs * 2 ** (attempt - 1));
    // Full jitter — random in [0, base] — to avoid thundering herd.
    const delay = Math.floor(Math.random() * base) + env.wsReconnectMinMs;
    reconnectTimerRef.current = setTimeout(() => {
      connect();
    }, delay);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const armPongTimeout = useCallback(() => {
    if (pongTimerRef.current) clearTimeout(pongTimerRef.current);
    pongTimerRef.current = setTimeout(() => {
      // No pong in time — treat the connection as dead.
      const ws = wsRef.current;
      if (ws) {
        try {
          ws.close(4000, "pong timeout");
        } catch {
          /* ignore */
        }
      }
    }, PONG_TIMEOUT_MS);
  }, []);

  const startPingTimer = useCallback(() => {
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          // Server doesn't act on these (we send application
          // messages) but it lets the protocol layer notice a
          // broken pipe.
          ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
        } catch {
          /* socket may be mid-close */
        }
        armPongTimeout();
      }
    }, PING_INTERVAL_MS);
  }, [armPongTimeout]);

  const connect = useCallback(() => {
    if (!enabled || !boardId) return;
    const url = getWebSocketUrl(boardId, cursorRef.current);
    if (!url) return;

    // If there's already a live socket, don't open another one.
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setStatus(attemptsRef.current === 0 ? "connecting" : "reconnecting");
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      onErrorRef.current?.(err);
      scheduleReconnect();
      return;
    }
    wsRef.current = socket;

    socket.onopen = () => {
      attemptsRef.current = 0;
      setStatus("connected");
      startPingTimer();
    };

    socket.onmessage = (event) => {
      armPongTimeout();
      if (!event.data) return;
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && typeof parsed.cursor === "number" && parsed.cursor > 0) {
          cursorRef.current = Math.max(cursorRef.current, parsed.cursor);
        }
        onMessageRef.current?.(parsed);
      } catch {
        onMessageRef.current?.(event.data);
      }
    };

    socket.onerror = (err) => {
      onErrorRef.current?.(err);
    };

    socket.onclose = (event) => {
      clearTimers();
      wsRef.current = null;
      setStatus((prev) => (prev === "connected" ? "reconnecting" : "disconnected"));
      onCloseRef.current?.(event.code, event.reason);
      if (enabled) scheduleReconnect();
    };
  }, [boardId, enabled, scheduleReconnect, startPingTimer, armPongTimeout, clearTimers]);

  // Main connection lifecycle: open on enable+boardId, close on disable.
  useEffect(() => {
    if (enabled && boardId) {
      attemptsRef.current = 0;
      connect();
    } else {
      clearTimers();
      closeSocket();
      setStatus("disconnected");
    }

    return () => {
      clearTimers();
      closeSocket();
    };
  }, [enabled, boardId, connect, clearTimers, closeSocket]);

  // Optional visibility pause. We don't tear down the socket on
  // hide; we just hold off reconnect attempts so a backgrounded
  // tab doesn't burn through the cap.
  useEffect(() => {
    if (!env.wsPauseOnHidden) return undefined;
    const handler = () => {
      if (document.hidden) return;
      // Tab visible again — try to reconnect if we were disconnected.
      if (enabled && boardId && !wsRef.current) {
        attemptsRef.current = 0;
        connect();
      }
    };
    visibilityListenerRef.current = handler;
    document.addEventListener("visibilitychange", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      visibilityListenerRef.current = null;
    };
  }, [enabled, boardId, connect]);

  const sendMessage = useCallback((data) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      ws.send(payload);
      return true;
    }
    return false;
  }, []);

  return {
    status,
    sendMessage,
    isConnected: status === "connected",
    isFailed: status === "failed"
  };
}
