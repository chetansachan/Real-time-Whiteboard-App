package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL string
}

func Load() (*Config, error) {
	err := godotenv.Load()
	if err != nil {
		log.Fatalf("Error loading .env file: %v", err)
	}

	var config *Config = &Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
	}
	return config, nil
}
