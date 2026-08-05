package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"realtime-whiteboard/internals/model"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrBoardNotFound = errors.New("board not found")

type BoardRepository struct {
	pool *pgxpool.Pool
}

func NewBoardRepository(pool *pgxpool.Pool) *BoardRepository {
	return &BoardRepository{pool: pool}
}

func (r *BoardRepository) CreateBoard(ctx context.Context, board *model.Board) error {
	pagesBytes, err := json.Marshal(board.Pages)
	if err != nil {
		return fmt.Errorf("failed to marshal pages: %w", err)
	}

	query := `
		INSERT INTO boards (board_id, title, pages, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5)
	`

	_, err = r.pool.Exec(ctx, query, board.BoardID, board.Title, pagesBytes, board.CreatedAt, board.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert board into database: %w", err)
	}

	return nil
}

func (r *BoardRepository) GetBoardByID(ctx context.Context, id uuid.UUID) (model.Board, error) {
	var b model.Board
	var pagesData []byte

	query := `SELECT board_id, title, pages, created_at, updated_at FROM boards WHERE board_id = $1`
	err := r.pool.QueryRow(ctx, query, id).Scan(&b.BoardID, &b.Title, &pagesData, &b.CreatedAt, &b.UpdatedAt)

	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		return b, ErrBoardNotFound
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

func (r *BoardRepository) UpdateBoardByID(ctx context.Context, id uuid.UUID, title string) (model.Board, error) {
	var board model.Board
	var pagesData []byte
	query := `
		UPDATE boards 
		SET title = $1, updated_at = NOW() 
		WHERE board_id = $2
		RETURNING board_id, title, pages, created_at, updated_at
	`
	if err:= r.pool.QueryRow(ctx,query,title,id).Scan(&board.BoardID, &board.Title, &pagesData, &board.CreatedAt, &board.UpdatedAt); err != nil{
		return model.Board{}, fmt.Errorf("failed to update board into database: %w", err)
	}

		if err := json.Unmarshal(pagesData, &board.Pages); err != nil {
			return board, fmt.Errorf("failed to parse board pages: %w", err)
		}

	return board, nil
}
