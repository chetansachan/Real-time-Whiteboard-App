package routers

import (
	"net/http"

	"realtime-whiteboard/internals/controllers"
	"realtime-whiteboard/internals/repository"
	"realtime-whiteboard/internals/service"

	"github.com/jackc/pgx/v5/pgxpool"
)

func SetupRouter(pool *pgxpool.Pool) *http.ServeMux {
	mux := http.NewServeMux()

	boardRepo := repository.NewBoardRepository(pool)
	boardService := service.NewBoardService(boardRepo)
	boardController := controllers.NewBoardController(boardService)

	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello world"))
	})

	mux.HandleFunc("POST /api/boards", boardController.CreateBoardController)

	return mux
}
