package routers

import (
	"net/http"

	"realtime-whiteboard/internals/controllers"
)

func SetupRouter() *http.ServeMux {
	mux := http.NewServeMux()

	boardController := controllers.NewBoardController()

	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello world"))
	})

	mux.HandleFunc("POST /api/boards", boardController.CreateBoard)

	return mux
}
