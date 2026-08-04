package main

import (
	"fmt"
	"log"
	"net/http"

	"realtime-whiteboard/internals/routers"
)

func main() {
	router := routers.SetupRouter()

	fmt.Println("Server running on :8080")
	if err := http.ListenAndServe(":8080", router); err != nil {
		log.Fatalf("Error Starting Server: %v", err)
	}
}

