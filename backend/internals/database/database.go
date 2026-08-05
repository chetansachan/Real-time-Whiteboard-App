package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
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

func Connect(databaseURL string) (*pgxpool.Pool, error) {
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
