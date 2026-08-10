// Package logger provides a thin wrapper around log/slog that the rest of
// the application can use to emit structured JSON logs.
package logger

import (
	"log/slog"
	"os"
	"strings"
)

// Init builds a slog.Logger configured from environment variables and
// installs it as the process default logger.
//
//   - LOG_LEVEL   : debug | info | warn | error (default: info)
//   - LOG_FORMAT  : json | text                            (default: json)
//
// Always returns a usable logger, even if configuration is invalid, so the
// caller never has to nil-check.
func Init() *slog.Logger {
	level := parseLevel(os.Getenv("LOG_LEVEL"))
	handlerOpts := &slog.HandlerOptions{Level: level}

	var handler slog.Handler
	switch strings.ToLower(os.Getenv("LOG_FORMAT")) {
	case "text":
		handler = slog.NewTextHandler(os.Stdout, handlerOpts)
	default:
		handler = slog.NewJSONHandler(os.Stdout, handlerOpts)
	}

	logger := slog.New(handler)
	slog.SetDefault(logger)
	return logger
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
