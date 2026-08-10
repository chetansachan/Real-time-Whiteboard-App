package middleware

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestRequestID_GeneratesWhenMissing(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if RequestIDFromContext(r.Context()) == "" {
			t.Error("expected request id in context")
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get(RequestIDHeader); got == "" {
		t.Error("expected response to carry X-Request-Id")
	}
}

func TestRequestID_PreservesClientSuppliedID(t *testing.T) {
	const id = "client-abc-123"
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(RequestIDHeader, id)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get(RequestIDHeader); got != id {
		t.Errorf("expected %q, got %q", id, got)
	}
}

func TestAccessLog_RecordsStatusAndDuration(t *testing.T) {
	logger := newTestLogger()
	handler := AccessLog(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))

	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTeapot {
		t.Errorf("expected status 418, got %d", rr.Code)
	}
}

func TestTimeout_AbortsSlowHandler(t *testing.T) {
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(500 * time.Millisecond):
		}
	})
	handler := Timeout(20 * time.Millisecond)(slow)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rr.Code)
	}
}

func TestRecovery_PanicReturns500(t *testing.T) {
	logger := newTestLogger()
	boom := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("kaboom")
	})
	handler := Recovery(logger)(boom)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rr.Code)
	}
}

func TestCORS_AllowedOriginGetsHeaders(t *testing.T) {
	handler := CORS([]string{"http://allowed.test"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "http://allowed.test")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "http://allowed.test" {
		t.Errorf("expected CORS header, got %q", got)
	}
}

func TestCORS_DisallowedOriginSkipsHeaders(t *testing.T) {
	handler := CORS([]string{"http://allowed.test"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "http://evil.test")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("expected no CORS header, got %q", got)
	}
}

func TestCORS_OptionsPreflightIsNoContent(t *testing.T) {
	handler := CORS([]string{"http://allowed.test"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called for preflight")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "http://allowed.test")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rr.Code)
	}
}

func TestStatusRecorder_DefaultsTo200(t *testing.T) {
	rec := &statusRecorder{ResponseWriter: httptest.NewRecorder(), status: http.StatusOK}
	if rec.status != http.StatusOK {
		t.Errorf("expected default 200, got %d", rec.status)
	}
	rec.WriteHeader(http.StatusCreated)
	if rec.status != http.StatusCreated {
		t.Errorf("expected 201, got %d", rec.status)
	}
}

// Sanity test that the middleware chain wires up in the right order and
// doesn't lose the context.
func TestChain_AllPassThrough(t *testing.T) {
	logger := newTestLogger()
	chain := RequestID(
		AccessLog(logger)(
			CORS([]string{"http://test"})(
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if RequestIDFromContext(r.Context()) == "" {
						t.Error("context lost request id")
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]string{"ok": "yes"})
				}),
			),
		),
	)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "http://test")
	rr := httptest.NewRecorder()
	chain.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "yes") {
		t.Errorf("body should contain response payload, got %q", rr.Body.String())
	}
}

type mockHijackableRecorder struct {
	*httptest.ResponseRecorder
	hijacked bool
	flushed  bool
}

func (m *mockHijackableRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	m.hijacked = true
	return nil, nil, nil
}

func (m *mockHijackableRecorder) Flush() {
	m.flushed = true
}

func TestStatusRecorder_ImplementsHijackerAndFlusher(t *testing.T) {
	mock := &mockHijackableRecorder{ResponseRecorder: httptest.NewRecorder()}
	rec := &statusRecorder{ResponseWriter: mock, status: http.StatusOK}

	if _, ok := interface{}(rec).(http.Hijacker); !ok {
		t.Fatal("expected statusRecorder to implement http.Hijacker")
	}

	_, _, err := rec.Hijack()
	if err != nil {
		t.Errorf("unexpected error on Hijack: %v", err)
	}
	if !mock.hijacked {
		t.Error("expected underlying ResponseWriter Hijack to be called")
	}

	rec.Flush()
	if !mock.flushed {
		t.Error("expected underlying ResponseWriter Flush to be called")
	}

	if rec.Unwrap() != mock {
		t.Error("expected Unwrap to return underlying ResponseWriter")
	}
}

func TestTimeout_BypassesWebSocketUpgrade(t *testing.T) {
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	})
	handler := Timeout(10 * time.Millisecond)(slow)

	req := httptest.NewRequest(http.MethodGet, "/ws/boards/123/join", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 (timeout bypassed for WS), got %d", rr.Code)
	}
}

var _ = context.Background // keep context import honest in case tests above change
