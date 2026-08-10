// Package database owns the PostgreSQL connection pool and the one-time
// migration step. Returning errors rather than calling log.Fatal lets the
// caller decide how to handle startup failures.
package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/golang-migrate/migrate/v4"
	migratepostgres "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/lib/pq"
)

// Connect builds a pgx pool and ensures migrations have been applied.
//
// It is split into "open a sql.DB just for migrations" and "open a pgxpool
// for the application" because golang-migrate speaks database/sql while the
// rest of the app uses pgx. Both URLs come from cfg.DatabaseURL.
func Connect(ctx context.Context, databaseURL string, logger *slog.Logger) (*pgxpool.Pool, error) {
	if databaseURL == "" {
		return nil, errors.New("database url is empty")
	}

	if err := runMigrations(ctx, databaseURL, logger); err != nil {
		return nil, fmt.Errorf("migrations: %w", err)
	}

	poolCfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	// Sensible defaults; can be tuned by env later.
	if poolCfg.MaxConns == 0 {
		poolCfg.MaxConns = 10
	}
	poolCfg.MaxConnLifetime = 30 * time.Minute
	poolCfg.HealthCheckPeriod = 1 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	logger.Info("database_connected", slog.String("host", redactHost(databaseURL)))
	return pool, nil
}

// runMigrations applies any pending up migrations using golang-migrate.
// On a clean database it simply runs them; on a half-migrated state the
// dirty-flag recovery is left to a human (logged loudly).
func runMigrations(ctx context.Context, databaseURL string, logger *slog.Logger) error {
	migCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return fmt.Errorf("open migration db: %w", err)
	}
	defer db.Close()

	// sql.Open is lazy; force a real connection with a deadline.
	pingCtx, pingCancel := context.WithTimeout(migCtx, 5*time.Second)
	defer pingCancel()
	if err := db.PingContext(pingCtx); err != nil {
		return fmt.Errorf("ping migration db: %w", err)
	}

	driver, err := migratepostgres.WithInstance(db, &migratepostgres.Config{})
	if err != nil {
		return fmt.Errorf("create migration driver: %w", err)
	}

	m, err := migrate.NewWithDatabaseInstance("file://migrations", "postgres", driver)
	if err != nil {
		return fmt.Errorf("init migration: %w", err)
	}

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("apply migrations: %w", err)
	}
	logger.Info("migrations_applied")
	return nil
}

// redactHost hides credentials but keeps the host:port so logs are
// still useful when debugging connection issues.
func redactHost(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "<unparseable>"
	}
	return u.Host
}
