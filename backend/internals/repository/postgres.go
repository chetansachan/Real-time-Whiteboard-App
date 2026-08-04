package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"realtime-whiteboard/internals/model"

	"github.com/google/uuid"
)

func GetBoardByID(db *sql.DB, id uuid.UUID) (model.Board, error) {
	var b model.Board
	var pagesData []byte

	err := db.QueryRow("SELECT board_id, title, pages, created_at, updated_at FROM boards WHERE board_id = $1", id).Scan(&b.BoardID, &b.Title, &pagesData, &b.CreatedAt, &b.UpdatedAt)

	if err == sql.ErrNoRows {
		return b, fmt.Errorf("board not found")
	} else if err != nil {
		return b, err
	}

	if len(pagesData) > 0 {
		if err := json.Unmarshal(pagesData, &b.Pages); err != nil {
			return b, fmt.Errorf("failed to parse board pages: %w", err)
		}
	}

	return b, nil
}
