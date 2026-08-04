package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello world"))
	})

	fmt.Println("Server running on :8080")
	if err:=http.ListenAndServe(":8080", mux); err!=nil{
		log.Fatal("Error Starting Server")
	}
}
