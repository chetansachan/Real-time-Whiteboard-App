package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/lib/pq"
)

func runDatabaseMigrations(db *sql.DB) {
	var tableExists bool
	checkQuery := "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'boards')"
	if err := db.QueryRow(checkQuery).Scan(&tableExists); err != nil {
		log.Printf("Warning checking table existence: %v", err)
	}

	if !tableExists {
		log.Println("Table 'boards' does not exist. Resetting migration tracker to execute migrations...")
		_, _ = db.Exec("DROP TABLE IF EXISTS schema_migrations")
	}

	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		log.Fatalf("Could not create migration database driver: %v", err)
	}

	m, err := migrate.NewWithDatabaseInstance("file://migrations", "postgres", driver)
	if err != nil {
		log.Fatalf("Could not initialize migration instance: %v", err)
	}

	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("Migration run failed: %v", err)
	}

	log.Println("Database migration validation complete: Up to date.")
}

func ensureDatabaseExists(databaseURL string) error {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return fmt.Errorf("unable to parse database URL: %w", err)
	}

	targetDB := strings.TrimPrefix(u.Path, "/")
	if targetDB == "" || targetDB == "postgres" {
		return nil
	}

	u.Path = "/postgres"
	defaultConnStr := u.String()

	db, err := sql.Open("postgres", defaultConnStr)
	if err != nil {
		return fmt.Errorf("failed to open default postgres connection: %w", err)
	}
	defer db.Close()

	var exists bool
	query := "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)"
	if err := db.QueryRow(query, targetDB).Scan(&exists); err != nil {
		return fmt.Errorf("failed to query database existence: %w", err)
	}

	if !exists {
		log.Printf("Database %q does not exist. Creating database in PostgreSQL...", targetDB)
		createSQL := fmt.Sprintf("CREATE DATABASE %q", targetDB)
		if _, err := db.Exec(createSQL); err != nil {
			return fmt.Errorf("failed to create database %q: %w", targetDB, err)
		}
		log.Printf("Successfully created database %q in PostgreSQL", targetDB)
	}

	return nil
}

func Connect(databaseURL string) (*pgxpool.Pool, error) {
	if err := ensureDatabaseExists(databaseURL); err != nil {
		log.Printf("Error verifying/creating database: %v", err)
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		log.Printf("Unable to parse DATABASE_URL: %v", err)
		return nil, err
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	runDatabaseMigrations(db)

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		log.Printf("Unable to create connection pool: %v", err)
		return nil, err
	}

	err = pool.Ping(ctx)
	if err != nil {
		log.Printf("Unable to ping database: %v", err)
		pool.Close()
		return nil, err
	}

	fmt.Println("Successfully Connected to PostgresSQL database")
	return pool, err
}
