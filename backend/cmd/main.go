package main

import (
	"fmt"
	"log"
	"net/http"

	"realtime-whiteboard/internals/config"
	"realtime-whiteboard/internals/database"
	"realtime-whiteboard/internals/routers"
)

func main() {
	router := routers.SetupRouter()

	cfg, err := config.Load()
	if err != nil {
		log.Fatal("Failed to load Configuration:", err)
	}

	pool, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("Failed to connect to database:", err)
	}
	defer pool.Close()

	fmt.Println("Server running on :8080")
	if err := http.ListenAndServe(":8080", router); err != nil {
		log.Fatalf("Error Starting Server: %v", err)
	}
}
