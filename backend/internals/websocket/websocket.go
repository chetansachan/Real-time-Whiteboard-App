package websocket

import (
	"bytes"
	"net/http"
	"realtime-whiteboard/internals/model"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}


func ServerWS(hub *model.Hub, w http.ResponseWriter, r *http.Request){
	conn, err := upgrader.Upgrade(w,r,nil)
	if err != nil {
		http.Error(w, "Error upgrading connection to websocket", http.StatusBadRequest)
		return
	}

	client := &model.Client{
		ID: uuid.New(),
		UserID: uuid.New(),
		BoardID: uuid.New(),
		Conn: conn,
		Hub: hub,
		Send: make(chan []byte, 256),
	}
}