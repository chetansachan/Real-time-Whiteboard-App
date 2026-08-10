// Package middleware contains production HTTP middleware used by the
// whiteboard API server: request IDs, structured access logging, request
// timeouts, recovery, and CORS.
package middleware

import (
	"bufio"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// RequestIDHeader is the canonical header we both read and write.
	RequestIDHeader = "X-Request-Id"
	// requestIDKey is the context key under which the request id is stored.
	requestIDKey ctxKey = "request_id"
)

type ctxKey string

// RequestID ensures every request has an X-Request-Id header. If the client
// already provided one it is preserved; otherwise a new UUID is generated.
// The id is also stashed on the request context.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(RequestIDHeader)
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set(RequestIDHeader, id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestIDFromContext returns the request id stored on ctx, or "" if none.
func RequestIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok {
		return v
	}
	return ""
}

// AccessLog logs a single structured line per request after the handler
// returns. Status, latency, method, path, and request id are captured.
func AccessLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rw, r)
			logger.LogAttrs(r.Context(), slog.LevelInfo, "http_request",
				slog.String("request_id", RequestIDFromContext(r.Context())),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", rw.status),
				slog.Duration("duration", time.Since(start)),
				slog.String("remote", clientIP(r)),
			)
		})
	}
}

// Timeout aborts handlers that take longer than the supplied duration. The
// response is given a 503 status so callers can detect the timeout.
// WebSocket upgrade requests bypass timeout as they are long-lived connections.
func Timeout(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isWebSocketUpgrade(r) {
				next.ServeHTTP(w, r)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), d)
			defer cancel()
			done := make(chan struct{})
			go func() {
				defer close(done)
				next.ServeHTTP(w, r.WithContext(ctx))
			}()
			select {
			case <-done:
			case <-ctx.Done():
				if ctx.Err() == context.DeadlineExceeded {
					http.Error(w, "request timed out", http.StatusServiceUnavailable)
				}
			}
		})
	}
}

func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

// Recovery turns panics into 500 responses and logs the stack trace.
func Recovery(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					logger.Error("panic_recovered",
						slog.Any("error", rec),
						slog.String("request_id", RequestIDFromContext(r.Context())),
						slog.String("stack", string(debug.Stack())),
					)
					http.Error(w, "internal server error", http.StatusInternalServerError)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// CORS sets the cross-origin headers and short-circuits OPTIONS preflights.
// allowedOrigins is the list of origins that may make credentialed requests;
// use "*" to allow any origin (but never with credentials).
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && originAllowed(origin, allowedOrigins) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func originAllowed(origin string, allowed []string) bool {
	for _, a := range allowed {
		if a == "*" || a == origin {
			return true
		}
	}
	return false
}

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	return r.RemoteAddr
}

// statusRecorder is a tiny ResponseWriter wrapper that captures the status
// code so the access log middleware can include it. It also implements
// http.Hijacker, http.Flusher, and Unwrap to preserve optional ResponseWriter interfaces.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := r.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, errors.New("http.Hijacker interface not supported by underlying ResponseWriter")
}

func (r *statusRecorder) Flush() {
	if fl, ok := r.ResponseWriter.(http.Flusher); ok {
		fl.Flush()
	}
}

func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}
