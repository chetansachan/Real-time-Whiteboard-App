import { useEffect, useRef, useState, useCallback } from "react";
import { getWebSocketUrl } from "../services/boardApi.js";

export function useBoardWebSocket({ boardId, enabled = false, onMessage, onError }) {
  const [status, setStatus] = useState("disconnected");
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const connect = useCallback(() => {
    if (!boardId || !enabled) return;

    const url = getWebSocketUrl(boardId);
    if (!url) return;

    setStatus("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
    };

    ws.onmessage = (event) => {
      if (!event.data) return;
      try {
        const parsed = JSON.parse(event.data);
        onMessage?.(parsed);
      } catch {
        onMessage?.(event.data);
      }
    };

    ws.onerror = (err) => {
      setStatus("error");
      onError?.(err);
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
      // Auto-reconnect after 3 seconds if enabled
      if (enabled) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };
  }, [boardId, enabled, onMessage, onError]);

  useEffect(() => {
    if (enabled && boardId) {
      connect();
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setStatus("disconnected");
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, boardId, connect]);

  const sendMessage = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      wsRef.current.send(payload);
      return true;
    }
    return false;
  }, []);

  return {
    status,
    sendMessage,
    isConnected: status === "connected"
  };
}
