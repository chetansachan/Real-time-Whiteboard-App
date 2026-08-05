package config

import (
	"fmt"
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL string
}

func Load() (*Config, error) {
	// Attempt to load .env from current directory or parent directory
	if err := godotenv.Load(".env"); err != nil {
			log.Println(".env file not found")

	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is missing")
	}

	return &Config{
		DatabaseURL: dbURL,
	}, nil
}
