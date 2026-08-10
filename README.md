# Real-Time Whiteboard

A collaborative whiteboard built as a React 19 + Vite frontend with a Go
HTTP / WebSocket backend, persisting boards, pages, and a replayable
event log in PostgreSQL.

## Project layout

```
.
├── src/                 React frontend
│   ├── App.jsx          Root component + route table
│   ├── main.jsx         App bootstrap (StrictMode, providers, error boundary)
│   ├── App.css          Styles
│   ├── config/          Build-time env (validated)
│   ├── constants/       Static config (tools, colors)
│   ├── data/            Seed data for the in-memory starter board
│   ├── hooks/           React hooks (controller, api, ws, toast, persistence)
│   ├── pages/           Top-level routes (Dashboard, BoardEditor)
│   ├── services/        REST + WebSocket clients
│   ├── components/      Shared components (ErrorBoundary, Modal, Toast, Loading)
│   │   └── editor/      Board-editor sub-components (toolbar, style panel, ...)
│   └── utils/           Pure helpers (whiteboard math, canvas renderer, export)
├── backend/             Go service
│   ├── cmd/             Service entry point (graceful shutdown, slog)
│   ├── internals/
│   │   ├── config/      Env-driven config
│   │   ├── controllers/ HTTP handlers
│   │   ├── database/    pgxpool + migrations
│   │   ├── logger/      slog setup
│   │   ├── middleware/  request id, access log, recovery, timeout, CORS
│   │   ├── model/       Domain types
│   │   ├── repository/  BoardRepository interface + Postgres implementation
│   │   ├── routers/     HTTP routes + middleware wiring
│   │   ├── service/     Business logic, validation, error mapping
│   │   └── websocket/   Per-board hub, ping/pong, slow-consumer drop
│   └── migrations/      SQL migrations (up + down)
├── .env.example         Frontend env template
└── package.json
```

## Quick start

### Frontend

```bash
cp .env.example .env       # then edit if needed
npm install
npm run dev                # http://localhost:5173
```

### Backend

```bash
cd backend
cp .env.example .env       # set DATABASE_URL
go mod tidy
go run ./cmd               # http://localhost:8080
```

The frontend dev server proxies `/api` and `/ws` to `http://127.0.0.1:8080`
by default (see `vite.config.js`).

## Environment variables

### Frontend (Vite, `VITE_*`)

| Variable                  | Default              | Notes                                    |
|---------------------------|----------------------|------------------------------------------|
| `VITE_API_BASE_URL`       | `""` (use proxy)     | Full URL to the backend, e.g. `http://localhost:8080` |
| `VITE_API_TIMEOUT_MS`     | `15000`              | Per-request timeout                      |
| `VITE_API_MAX_RETRIES`    | `2`                  | Retries on transient (5xx/network) errors |
| `VITE_WS_RECONNECT_MIN_MS`| `1000`               | Min backoff between WS reconnects        |
| `VITE_WS_RECONNECT_MAX_MS`| `15000`              | Max backoff                              |
| `VITE_WS_PAUSE_ON_HIDDEN` | `true`               | Hold off reconnects while the tab is hidden |

All variables are validated at startup in `src/config/env.js`. Misconfiguration
fails the build, not just the affected request.

### Backend

| Variable               | Default                         | Notes                                  |
|------------------------|---------------------------------|----------------------------------------|
| `HTTP_ADDR`            | `:8080`                         |                                        |
| `DATABASE_URL`         | **required**                    | Postgres connection string             |
| `REQUEST_TIMEOUT`      | `30s`                           | Per-request handler timeout            |
| `SHUTDOWN_TIMEOUT`     | `15s`                           | Graceful shutdown deadline             |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Comma-separated; `*` to allow any |
| `WS_READ_LIMIT`        | `1048576` (1 MiB)               | Per-message limit                      |
| `WS_WRITE_WAIT`        | `10s`                           | Write deadline                         |
| `WS_PING_PERIOD`       | `30s`                           | Server-side ping cadence               |
| `LOG_LEVEL`            | `info`                          | `debug` / `info` / `warn` / `error`    |
| `LOG_FORMAT`           | `json`                          | `json` / `text`                        |

See `backend/.env.example` for the full list.

## API

| Method | Path                          | Notes                                  |
|--------|-------------------------------|----------------------------------------|
| GET    | `/healthz`                    | Liveness probe                         |
| GET    | `/api/boards`                 | List boards                            |
| POST   | `/api/boards`                 | Create a board                         |
| GET    | `/api/boards/{id}`            | Fetch board (with pages + latest cursor) |
| PATCH  | `/api/boards/{id}`            | Rename a board                         |
| DELETE | `/api/boards/{id}`            | Delete a board (cascades pages, events)|
| POST   | `/api/boards/{id}/pages`      | Append a page                          |
| GET    | `/api/boards/{id}/events`     | Events with `?after=<cursor>`         |
| GET    | `/ws/boards/{id}/join`        | WebSocket upgrade (`?cursor=<n>` to replay missed events) |

Errors are plain text bodies with the appropriate status code. The
service layer returns sentinel errors that the controller maps:

| Sentinel error     | HTTP status |
|--------------------|-------------|
| `ErrBoardNotFound` | 404         |
| `ErrInvalidID`     | 404         |
| `ErrTitleTooLong`  | 400         |
| `ErrTitleInvalid`  | 400         |
| `ErrPageNameRequired` | 400      |
| `ErrPageNameTooLong` | 400       |
| anything else      | 500         |

## Realtime protocol

The websocket serves a per-board hub. Each client receives:

1. A snapshot of every page's elements on connect (synthetic `elements`
   messages), so a fresh client can paint the current state.
2. Any events past its `cursor` (when reconnecting with `?cursor=N`).
3. Live fan-out of subsequent messages from other clients.

The server also persists every non-ephemeral event into the `events`
table with a monotonically increasing `cursor`. Clients should treat
the highest `cursor` they have seen as their resume token.

The server distinguishes ephemeral events (`cursor`, `presence.*`) from
durable ones — ephemeral events are not stored and not replayed.

## Frontend architecture

* `useWhiteboardController` owns all canvas state via `useReducer`.
  Hot-path state (preview, selection box) and `undoStack` / `redoStack`
  live outside the reducer so a 60 fps pointer move doesn't churn
  through React.
* Refs mirror the latest state for the pointer handlers so a stale
  closure can't capture outdated elements / selectedIds.
* `useBoardWebSocket` keeps the connection ref-stable so the
  `useEffect` doesn't re-fire every render; reconnects use exponential
  backoff with full jitter and back off permanently after 12 failed
  attempts.
* `request()` retries idempotent calls (GET) on 5xx / network errors
  with exponential backoff and full jitter, and supports `AbortSignal`
  and per-request timeouts.

## Tests

```bash
# Frontend
npm test
npm run lint

# Backend
cd backend
go test ./...
go vet ./...
```

## Scripts

| Command           | What it does              |
|-------------------|---------------------------|
| `npm run dev`     | Vite dev server           |
| `npm run build`   | Production build          |
| `npm run preview` | Serve the build           |
| `npm run lint`    | ESLint                    |
| `npm test`        | Vitest (jsdom)            |
