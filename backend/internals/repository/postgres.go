package repository

import (
	"context"
	"database/sql"
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
	queryBoard := `
		INSERT INTO boards (board_id, title, created_at, updated_at)
		VALUES ($1, $2, $3, $4)
	`
	_, err := r.pool.Exec(ctx, queryBoard, board.BoardID, board.Title, board.CreatedAt, board.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert board into database: %w", err)
	}

	queryPage := `
		INSERT INTO pages (page_id, board_id, name)
		VALUES ($1, $2, $3)
	`
	for _, page := range board.Pages {
		pageID := page.PageID
		if pageID == uuid.Nil {
			pageID = uuid.New()
		}
		_, err := r.pool.Exec(ctx, queryPage, pageID, board.BoardID, page.Name)
		if err != nil {
			return fmt.Errorf("failed to insert page into database: %w", err)
		}
	}
	return nil
}

func (r *BoardRepository) GetBoardByID(ctx context.Context, id uuid.UUID) (model.Board, error) {
	var b model.Board

	queryBoard := `SELECT board_id, title, created_at, updated_at FROM boards WHERE board_id = $1`
	err := r.pool.QueryRow(ctx, queryBoard, id).Scan(&b.BoardID, &b.Title, &b.CreatedAt, &b.UpdatedAt)

	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		return b, ErrBoardNotFound
	} else if err != nil {
		return b, fmt.Errorf("failed to query board: %w", err)
	}

	queryPages := `SELECT page_id, name FROM pages WHERE board_id = $1`
	rows, err := r.pool.Query(ctx, queryPages, id)
	if err != nil {
		return b, fmt.Errorf("failed to query board pages: %w", err)
	}
	defer rows.Close()

	b.Pages = []model.Page{}
	for rows.Next() {
		var p model.Page
		if err := rows.Scan(&p.PageID, &p.Name); err != nil {
			return b, fmt.Errorf("failed to scan page: %w", err)
		}
		b.Pages = append(b.Pages, p)
	}

	return b, nil
}

func (r *BoardRepository) UpdateBoardByID(ctx context.Context, id uuid.UUID, title string) (model.Board, error) {
	var board model.Board

	query := `
		UPDATE boards 
		SET title = $1, updated_at = NOW() 
		WHERE board_id = $2
		RETURNING board_id, title, created_at, updated_at
	`
	err := r.pool.QueryRow(ctx, query, title, id).Scan(&board.BoardID, &board.Title, &board.CreatedAt, &board.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
		return model.Board{}, ErrBoardNotFound
	} else if err != nil {
		return model.Board{}, fmt.Errorf("failed to update board into database: %w", err)
	}

	queryPages := `SELECT page_id, name FROM pages WHERE board_id = $1`
	rows, err := r.pool.Query(ctx, queryPages, id)
	if err != nil {
		return board, fmt.Errorf("failed to query board pages: %w", err)
	}
	defer rows.Close()

	board.Pages = []model.Page{}
	for rows.Next() {
		var p model.Page
		if err := rows.Scan(&p.PageID, &p.Name); err != nil {
			return board, fmt.Errorf("failed to scan page: %w", err)
		}
		board.Pages = append(board.Pages, p)
	}

	return board, nil
}
