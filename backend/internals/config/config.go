// Package config loads runtime configuration from environment variables.
// The Load function returns a validated Config or an explanatory error so
// the caller can fail fast at startup.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config aggregates every tunable value the server needs at startup.
type Config struct {
	// HTTP server
	HTTPAddr        string
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
	RequestTimeout  time.Duration

	// Database
	DatabaseURL string

	// WebSocket
	WSReadLimit  int64
	WSPingPeriod time.Duration
	WSWriteWait  time.Duration

	// CORS: comma-separated list of allowed origins. "*" disables credentials.
	AllowedOrigins []string

	// Logger
	LogLevel  string
	LogFormat string
}

// Load reads configuration from process env, optionally first sourcing a
// .env file from the current directory or the parent directory.
func Load() (*Config, error) {
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")

	cfg := &Config{
		HTTPAddr:        getEnv("HTTP_ADDR", ":8080"),
		ReadTimeout:     getDuration("HTTP_READ_TIMEOUT", 15*time.Second),
		WriteTimeout:    getDuration("HTTP_WRITE_TIMEOUT", 15*time.Second),
		IdleTimeout:     getDuration("HTTP_IDLE_TIMEOUT", 60*time.Second),
		ShutdownTimeout: getDuration("SHUTDOWN_TIMEOUT", 15*time.Second),
		RequestTimeout:  getDuration("REQUEST_TIMEOUT", 30*time.Second),
		DatabaseURL:     strings.TrimSpace(os.Getenv("DATABASE_URL")),
		WSReadLimit:     getInt64("WS_READ_LIMIT", 1<<20),
		WSPingPeriod:    getDuration("WS_PING_PERIOD", 30*time.Second),
		WSWriteWait:     getDuration("WS_WRITE_WAIT", 10*time.Second),
		AllowedOrigins:  splitCSV(getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173")),
		LogLevel:        getEnv("LOG_LEVEL", "info"),
		LogFormat:       getEnv("LOG_FORMAT", "json"),
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// Validate ensures the loaded config is internally consistent.
func (c *Config) Validate() error {
	if c.DatabaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	if c.HTTPAddr == "" {
		return errors.New("HTTP_ADDR must not be empty")
	}
	if c.RequestTimeout <= 0 {
		return errors.New("REQUEST_TIMEOUT must be positive")
	}
	if c.ShutdownTimeout <= 0 {
		return errors.New("SHUTDOWN_TIMEOUT must be positive")
	}
	if c.WSReadLimit <= 0 {
		return errors.New("WS_READ_LIMIT must be positive")
	}
	return nil
}

func getEnv(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func getDuration(key string, def time.Duration) time.Duration {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return def
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return def
	}
	return d
}

func getInt64(key string, def int64) int64 {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return def
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return def
	}
	return v
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// String redacts the secret database URL so logs are safe to print.
func (c *Config) String() string {
	url := c.DatabaseURL
	if at := strings.Index(url, "@"); at > 0 {
		if scheme := strings.Index(url, "://"); scheme > 0 && scheme+3 < at {
			url = url[:scheme+3] + "***" + url[at:]
		}
	}
	return fmt.Sprintf("Config{HTTPAddr=%s RequestTimeout=%s AllowedOrigins=%v LogLevel=%s DatabaseURL=%s}",
		c.HTTPAddr, c.RequestTimeout, c.AllowedOrigins, c.LogLevel, url)
}
