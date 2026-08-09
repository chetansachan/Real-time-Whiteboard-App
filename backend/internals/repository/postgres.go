package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

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
		INSERT INTO pages (page_id, board_id, name, elements)
		VALUES ($1, $2, $3, $4)
	`
	for _, page := range board.Pages {
		elementsJSON, err := json.Marshal(page.Elements)
		if err != nil {
			elementsJSON = []byte("[]")
		}
		_, err = r.pool.Exec(ctx, queryPage, page.PageID, board.BoardID, page.Name, elementsJSON)
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

	queryPages := `SELECT page_id, name, elements FROM pages WHERE board_id = $1`
	rows, err := r.pool.Query(ctx, queryPages, id)
	if err != nil {
		return b, fmt.Errorf("failed to query board pages: %w", err)
	}
	defer rows.Close()

	b.Pages = []model.Page{}
	for rows.Next() {
		var p model.Page
		var elementsRaw []byte
		if err := rows.Scan(&p.PageID, &p.Name, &elementsRaw); err != nil {
			return b, fmt.Errorf("failed to scan page: %w", err)
		}
		if len(elementsRaw) > 0 {
			_ = json.Unmarshal(elementsRaw, &p.Elements)
		}
		if p.Elements == nil {
			p.Elements = []model.Element{}
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

	queryPages := `SELECT page_id, name, elements FROM pages WHERE board_id = $1`
	rows, err := r.pool.Query(ctx, queryPages, id)
	if err != nil {
		return board, fmt.Errorf("failed to query board pages: %w", err)
	}
	defer rows.Close()

	board.Pages = []model.Page{}
	for rows.Next() {
		var p model.Page
		var elementsRaw []byte
		if err := rows.Scan(&p.PageID, &p.Name, &elementsRaw); err != nil {
			return board, fmt.Errorf("failed to scan page: %w", err)
		}
		if len(elementsRaw) > 0 {
			_ = json.Unmarshal(elementsRaw, &p.Elements)
		}
		if p.Elements == nil {
			p.Elements = []model.Element{}
		}
		board.Pages = append(board.Pages, p)
	}

	return board, nil
}

func (r *BoardRepository) AddPageByID(ctx context.Context, id uuid.UUID, name string) (model.Page, error) {
	page := model.Page{
		PageID:   uuid.New(),
		Name:     name,
		Elements: []model.Element{},
	}
	queryPage := `
		INSERT INTO pages (page_id, board_id, name, elements)
		VALUES ($1, $2, $3, $4)
	`
	elementsJSON, err := json.Marshal(page.Elements)
	if err != nil {
		elementsJSON = []byte("[]")
	}
	_, err = r.pool.Exec(ctx, queryPage, page.PageID, id, page.Name, elementsJSON)
	if err != nil {
		return model.Page{}, fmt.Errorf("failed to insert page into database: %w", err)
	}
	return page, nil
}

func (r *BoardRepository) SavePageElements(ctx context.Context, pageID uuid.UUID, elements []model.Element) error {
	elementsJSON, err := json.Marshal(elements)
	if err != nil {
		return fmt.Errorf("failed to marshal page elements: %w", err)
	}

	query := `
		UPDATE pages 
		SET elements = $1
		WHERE page_id = $2
	`
	_, err = r.pool.Exec(ctx, query, elementsJSON, pageID)
	if err != nil {
		return fmt.Errorf("failed to save page elements to database: %w", err)
	}

	return nil
}

func (r *BoardRepository) SaveBoardPageElements(ctx context.Context, boardID uuid.UUID, pageIDStr string, elements []model.Element) error {
	elementsJSON, err := json.Marshal(elements)
	if err != nil {
		return fmt.Errorf("failed to marshal page elements: %w", err)
	}

	pageID, parseErr := uuid.Parse(pageIDStr)
	if parseErr == nil {
		tag, err := r.pool.Exec(ctx, `UPDATE pages SET elements = $1 WHERE page_id = $2`, elementsJSON, pageID)
		if err == nil && tag.RowsAffected() > 0 {
			return nil
		}
	}

	// Fallback: update page by board_id
	_, err = r.pool.Exec(ctx, `
		UPDATE pages 
		SET elements = $1 
		WHERE board_id = $2 AND page_id = (SELECT page_id FROM pages WHERE board_id = $2 ORDER BY page_id LIMIT 1)
	`, elementsJSON, boardID)
	if err != nil {
		return fmt.Errorf("failed to save page elements by board id: %w", err)
	}
	return nil
}

func (r *BoardRepository) GetAllBoards(ctx context.Context) (model.Boards, error) {
	var result model.Boards
	result.Boards = []model.Board{}

	queryBoards := `SELECT * FROM boards ORDER BY created_at DESC`
	rows, err := r.pool.Query(ctx, queryBoards)
	if err != nil {
		return model.Boards{}, fmt.Errorf("failed to get boards from database: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var b model.Board
		if err := rows.Scan(&b.BoardID, &b.Title, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return model.Boards{}, fmt.Errorf("failed to scan board: %w", err)
		}
		b.Pages = []model.Page{}
		result.Boards = append(result.Boards, b)
	}
	if err := rows.Err(); err != nil {
		return model.Boards{}, fmt.Errorf("error iterating boards rows: %w", err)
	}
	return result, nil
}

func (r *BoardRepository) DeleteBoardById(ctx context.Context, id uuid.UUID) error {
	query := `
		DELETE FROM boards WHERE board_id = $1
	`

	_, err := r.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete board: %w", err)
	}

	return nil
}

func (r *BoardRepository) SaveEvent(ctx context.Context, evt *model.EventEnvelope) (int64, error) {
	boardID, err := uuid.Parse(evt.BoardID)
	if err != nil {
		return 0, fmt.Errorf("invalid board id: %w", err)
	}

	var pageID *uuid.UUID
	if evt.PageID != "" {
		if pid, err := uuid.Parse(evt.PageID); err == nil {
			pageID = &pid
		}
	}

	var userID *uuid.UUID
	if evt.UserID != "" {
		if uid, err := uuid.Parse(evt.UserID); err == nil {
			userID = &uid
		}
	}

	payloadJSON := evt.Payload
	if len(payloadJSON) == 0 {
		payloadJSON = []byte("{}")
	}

	query := `
		INSERT INTO events (board_id, page_id, user_id, type, payload, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING cursor
	`
	createdAt := evt.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}

	var cursor int64
	err = r.pool.QueryRow(ctx, query, boardID, pageID, userID, evt.Type, payloadJSON, createdAt).Scan(&cursor)
	if err != nil {
		return 0, fmt.Errorf("failed to insert event: %w", err)
	}
	evt.Cursor = cursor
	evt.CreatedAt = createdAt
	return cursor, nil
}

func (r *BoardRepository) GetEventsAfterCursor(ctx context.Context, boardID uuid.UUID, afterCursor int64) ([]model.EventEnvelope, int64, error) {
	query := `
		SELECT event_id, board_id, page_id, user_id, cursor, type, payload, created_at
		FROM events
		WHERE board_id = $1 AND cursor > $2
		ORDER BY cursor ASC
	`
	rows, err := r.pool.Query(ctx, query, boardID, afterCursor)
	if err != nil {
		return nil, afterCursor, fmt.Errorf("failed to query events: %w", err)
	}
	defer rows.Close()

	events := []model.EventEnvelope{}
	maxCursor := afterCursor

	for rows.Next() {
		var evt model.EventEnvelope
		var evtID, bID uuid.UUID
		var pID, uID *uuid.UUID
		var payloadBytes []byte

		if err := rows.Scan(&evtID, &bID, &pID, &uID, &evt.Cursor, &evt.Type, &payloadBytes, &evt.CreatedAt); err != nil {
			return nil, afterCursor, fmt.Errorf("failed to scan event row: %w", err)
		}

		evt.ID = evtID.String()
		evt.BoardID = bID.String()
		if pID != nil {
			evt.PageID = pID.String()
		}
		if uID != nil {
			evt.UserID = uID.String()
		}
		evt.Payload = payloadBytes

		if evt.Cursor > maxCursor {
			maxCursor = evt.Cursor
		}
		events = append(events, evt)
	}

	if err := rows.Err(); err != nil {
		return nil, afterCursor, fmt.Errorf("error iterating event rows: %w", err)
	}

	return events, maxCursor, nil
}

func (r *BoardRepository) GetLatestCursorForBoard(ctx context.Context, boardID uuid.UUID) (int64, error) {
	query := `SELECT COALESCE(MAX(cursor), 0) FROM events WHERE board_id = $1`
	var cursor int64
	err := r.pool.QueryRow(ctx, query, boardID).Scan(&cursor)
	if err != nil {
		return 0, fmt.Errorf("failed to query latest cursor: %w", err)
	}
	return cursor, nil
}