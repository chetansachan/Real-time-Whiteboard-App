# Real-Time Whiteboard Backend API

This is the design + implementation reference for the Go backend of the Real-Time Whiteboard project. The frontend is React (Vite, port 5173); the backend is Go with a layered structure — `cmd/main.go` boots config, `pgxpool`, and the WebSocket layer, and `internals/{config,database,repository,model,service,controllers,routers,websocket}` holds the rest.

This document mixes design intent with the parts that are already built:

- **Built today**: board REST routes under `/api/boards` (PostgreSQL via `pgxpool`) and the WebSocket relay under `internals/websocket/` that accepts connections at `/ws`.
- **Design intent** (not all built yet): the `EventEnvelope` shape, the rich `Hub`/`Client` with `RoomID`/`BoardID`/`Inbound`, the full event-type catalogue (`draw.stroke.added`, `presence.cursor`, etc.), persistence, history replay, and auth.

The WebSocket-specific sections below call out which parts are built and which are still design. The design parts describe what we are working toward; do not change them.

The most important idea is simple:

```text
The browser draws.
The Go backend does not draw.
The Go backend only receives events, checks them, saves them, and sends them to other users.
```

For a whiteboard, users do not send normal chat text when they draw. They send structured JSON events such as:

```json
{
  "type": "draw.stroke.added",
  "payload": {
    "element": {
      "id": "stroke-1",
      "type": "stroke",
      "points": [[10, 20, 0.5], [12, 22, 0.5]],
      "color": "#111111",
      "size": 5
    }
  }
}
```

Another user receives that event and their browser draws the same stroke.

## Beginner Vocabulary

### Board

A board is the whole whiteboard file.

Example:

```text
Board: "Project Ideas"
```

In code, a board has:

- `boardId`
- `title`
- pages
- saved drawing history

### Page

A page is one canvas inside a board. The frontend already supports multiple pages using the page buttons at the bottom left.

Example:

```text
Board "Project Ideas"
Page 1
Page 2
```

### Room

A room is the live collaboration session attached 1-to-1 to a board. When a user opens or joins a board using `boardId`, they join its live room where real-time drawing events, presence, and chat are broadcasted.

Example:

```text
Board & Room ID: "brd_123"
Users: Chetan, Mariya, Bob
```

### Element

An element is one thing on the canvas.

Examples:

- a pen stroke
- a rectangle
- a circle
- a sticky note
- a text label

### Event

An event is one action that happened.

Examples:

- user drew a stroke
- user added a rectangle
- user moved two selected shapes
- user deleted an element
- user sent a chat message

### Cursor

A cursor is a server-side event number. It tells clients how far they are synced.

Example:

```text
cursor 1: Chetan drew a line
cursor 2: Mariya added text
cursor 3: Chetan moved a rectangle
```

If a user disconnects at cursor `2`, they can reconnect and ask for events after cursor `2`.

## High-Level Architecture

The browser and backend should work like this:

```text
User draws on canvas
Browser creates JSON event
Browser sends event through WebSocket
Go backend validates event
Go backend saves event
Go backend broadcasts event to everyone in the room
Other browsers receive event
Other browsers update their canvas
```

The server is an event router. It should not try to draw anything.

## Build Order For The Go Backend

Build the backend in this order. Do not try to build everything at once.

### Step 1: Create Basic Board HTTP Routes

Start with normal HTTP routes before WebSockets.

You need these routes:

```text
POST   /api/boards
GET    /api/boards/{boardId}
PATCH  /api/boards/{boardId}
POST   /api/boards/{boardId}/pages
GET    /api/boards/{boardId}/events?after=0
```

At this stage, the backend only creates boards and returns board data.

### Step 2: Create Room Join And Leave Routes

Next, add room membership.

You need these routes:

```text
POST /api/rooms/{roomId}/join
POST /api/rooms/{roomId}/leave
```

This matters because chat should only work for users who joined the room.

### Step 3: Add WebSocket Connection

After HTTP routes work, add WebSocket support.

The WebSocket URL should look like this:

```text
GET /ws/rooms/{roomId}/boards/{boardId}?token={jwt}&cursor={lastSeenCursor}
```

For a beginner version, `token` can be fake or skipped while learning. Later, use real authentication.

### Step 4: Parse JSON Events

Every WebSocket message should be JSON. The server should decode it into one common envelope type.

### Step 5: Validate Events

Before broadcasting anything, check that the event is allowed.

Examples:

- Is the event type known?
- Is the user in the room?
- Is the board ID valid?
- Is the color valid?
- Is the text too long?
- Are there too many stroke points?

### Step 6: Save Events

After validation, save the event.

For a first version, you can store events in memory. Later, store them in a database.

### Step 7: Broadcast Events

After saving an event, send it to every connected client in the same room and board.

### Step 8: Replay History For Late Joiners

If someone joins after drawing already happened, they should not see a blank board.

When a client connects, send:

1. the current board snapshot
2. events after their last cursor

## Data Model

These are the important backend objects.

### Board

```go
type Board struct {
    ID        string    `json:"boardId"`
    Title     string    `json:"title"`
    Pages     []Page    `json:"pages"`
    CreatedAt time.Time `json:"createdAt"`
    UpdatedAt time.Time `json:"updatedAt"`
}
```

Meaning:

- `ID`: unique board ID
- `Title`: board name shown in the frontend top bar
- `Pages`: pages inside the board
- `CreatedAt`: when the board was created
- `UpdatedAt`: when it last changed

### Page

```go
type Page struct {
    ID   string `json:"pageId"`
    Name string `json:"name"`
}
```

Meaning:

- `ID`: unique page ID
- `Name`: page label, like `1`, `2`, or `Planning`

### EventEnvelope

Every WebSocket event should use this outer shape.

```go
type EventEnvelope struct {
    ID        string          `json:"id"`
    Type      string          `json:"type"`
    RoomID    string          `json:"roomId"`
    BoardID   string          `json:"boardId"`
    PageID    string          `json:"pageId,omitempty"`
    ClientID  string          `json:"clientId"`
    UserID    string          `json:"userId"`
    Cursor    int64           `json:"cursor"`
    CreatedAt time.Time       `json:"createdAt"`
    Payload   json.RawMessage `json:"payload"`
}
```

Why use an envelope?

Because every event needs shared metadata:

- who sent it
- which board it belongs to
- which room it belongs to
- when it happened
- what order it happened in
- what type of action happened

### Hub

A hub manages all live WebSocket clients for one room and board.

```go
type Hub struct {
    RoomID     string
    BoardID    string
    Clients    map[*Client]bool
    Register   chan *Client
    Unregister chan *Client
    Inbound    chan EventEnvelope
}
```

Meaning:

- `Clients`: connected users
- `Register`: new user joined WebSocket
- `Unregister`: user disconnected
- `Inbound`: event received from a user

### Client

A client is one browser tab connected by WebSocket.

```go
type Client struct {
    ID     string
    UserID string
    RoomID string
    BoardID string
    Hub    *Hub
    Conn   *websocket.Conn
    Send   chan EventEnvelope
}
```

Meaning:

- `Conn`: the actual WebSocket connection
- `Send`: events waiting to be sent to this browser
- `Hub`: the room manager this client belongs to

## HTTP Endpoints

HTTP is best for actions that happen once, such as creating a board or joining a room.

### `POST /api/boards`

Use this when the frontend wants to create a new whiteboard.

Request:

```json
{
  "title": "Unnamed Board"
}
```

Backend should:

1. Read `title` from the request.
2. Create a new `boardId`.
3. Create a default page, usually `page-1`.
4. Save the board.
5. Return the new board.

Response:

```json
{
  "boardId": "brd_123",
  "title": "Unnamed Board",
  "pages": [
    {
      "pageId": "page-1",
      "name": "1"
    }
  ],
  "createdAt": "2026-08-04T05:30:00Z"
}
```

### `GET /api/boards/{boardId}`

Use this when opening an existing board.

Backend should:

1. Find the board by `boardId`.
2. Return board title and pages.
3. Return the latest snapshot.
4. Return the latest cursor.

Response:

```json
{
  "boardId": "brd_123",
  "title": "Unnamed Board",
  "pages": [
    {
      "pageId": "page-1",
      "name": "1"
    }
  ],
  "snapshot": {
    "pageId": "page-1",
    "elements": []
  },
  "cursor": 184,
  "updatedAt": "2026-08-04T05:35:00Z"
}
```

What is `snapshot`?

A snapshot is the current board state. It is faster than replaying thousands of old events every time someone joins.

### `PATCH /api/boards/{boardId}`

Use this when renaming a board.

Request:

```json
{
  "title": "Planning Board"
}
```

Backend should:

1. Check the board exists.
2. Check the user has permission.
3. Update the board title.
4. Return the updated board.

### `POST /api/boards/{boardId}/pages`

Use this when the frontend adds a new page.

Request:

```json
{
  "name": "2"
}
```

Backend should:

1. Check the board exists.
2. Create a new page ID.
3. Save the page.
4. Broadcast a `page.created` event later if you want live page syncing.

### `GET /api/boards/{boardId}/events?after=184`

Use this when a client reconnects and needs missed events.

Example:

```text
Client already saw cursor 184.
Client asks for events after 184.
Server returns cursor 185, 186, 187...
```

Response:

```json
{
  "events": [],
  "cursor": 184
}
```

Backend should:

1. Read the `after` query value.
2. Find all events for this board with cursor greater than `after`.
3. Return those events in order.

### `POST /api/boards/{boardId}/join`

Use this when the user inputs a `boardId` and clicks "Join Board" in the frontend.

Request:

```json
{
  "userName": "Chetan"
}
```

Backend should:

1. Check the board exists.
2. Find or initialize the live room for this board.
3. Create a user session.
4. Add the user to the board participant list.
5. Return participant data.

Response:

```json
{
  "boardId": "brd_123",
  "userId": "usr_1",
  "participants": [
    {
      "userId": "usr_1",
      "name": "Chetan",
      "color": "#64be75"
    }
  ]
}
```

Important:

Chat and drawing events should be rejected unless the user has joined the board session.

### `POST /api/boards/{boardId}/leave`

Use this when the user clicks Leave Board.

Request:

```json
{}
```

Backend should:

1. Remove the user from the board session.
2. Close their WebSocket or mark them inactive.
3. Broadcast `presence.left` to other users on the board.
4. Stop accepting chat messages from that user for this board.

## WebSocket Endpoint

Use WebSocket for live events.

```text
GET /ws/boards/{boardId}?token={jwt}&cursor={lastSeenCursor}
```

Example:

```text
ws://localhost:8080/ws/boards/brd_123?cursor=184
```

When a browser connects:

1. Backend upgrades HTTP to WebSocket.
2. Backend checks the user is allowed in the board room.
3. Backend creates a `Client`.
4. Backend registers the client with the board `Hub`.
5. Backend sends missed events after `cursor`.
6. Backend starts reading new messages from the browser.
7. Backend starts writing broadcast events to the browser.

### Currently Implemented

The minimal viable relay is the only part of this design that is built today. It lives in `internals/websocket/` and is mounted on a flat URL — the room is not in the path, the room is sent inside the message body.

```text
GET /ws
```

Example:

```text
ws://localhost:8080/ws
```

When a browser connects today:

1. Backend upgrades HTTP to WebSocket (any origin is accepted — `CheckOrigin` returns `true`; tighten this for production).
2. Backend creates a `Client` with a server-generated UUID and a 256-buffered `send` channel.
3. Backend registers the client with the global `Hub` via the `register` channel.
4. Backend starts the client's `readPump` and `writePump` goroutines.
5. The frontend then sends a `join` message (see WebSocket Envelope below) to put itself into a room. There is no separate HTTP join step yet.

The path, the query params (`token`, `cursor`), the room/board scoping in the URL, and the missed-event replay on connect are all design intent and not yet wired up.

## WebSocket Envelope

Every WebSocket message should have the same outer structure.

```json
{
  "id": "evt_123",
  "type": "draw.stroke.added",
  "boardId": "brd_123",
  "pageId": "page-1",
  "clientId": "client_abc",
  "userId": "usr_1",
  "cursor": 185,
  "createdAt": "2026-08-04T05:36:00Z",
  "payload": {}
}
```

The frontend can send:

```json
{
  "id": "local_evt_1",
  "type": "chat.message",
  "boardId": "brd_123",
  "clientId": "client_abc",
  "payload": {
    "text": "Questions?"
  }
}
```

The server should add or replace:

- `userId`
- `cursor`
- `createdAt`

Never trust the browser for these server-owned fields.

### Currently Implemented

The actual envelope is much smaller than the design intent. Today there is no `id`, no `userId`, no `cursor`, no `createdAt`, no `payload`. Everything the client wants to send rides inside `content` as opaque JSON, and the server only inspects `type` and `room`.

```go
// internals/websocket/message.go
type Message struct {
    Type    string          `json:"type"`
    Room    string          `json:"room,omitempty"`
    Content json.RawMessage `json:"content,omitempty"`
}
```

Client to server:

```json
{
  "type": "join",
  "room": "design-room"
}
```

```json
{
  "type": "message",
  "room": "design-room",
  "content": {
    "shape": "line",
    "x1": 10, "y1": 20, "x2": 100, "y2": 200
  }
}
```

Server to client (reply to the same client only):

```json
{ "type": "joined", "room": "design-room" }
```

```json
{ "type": "left",   "room": "design-room" }
```

```json
{
  "type": "error",
  "room": "design-room",
  "content": "you are not a member of this room"
}
```

Server to client (forwarded from another member):

```json
{
  "type": "message",
  "room": "design-room",
  "content": { "shape": "line", "x1": 10, "y1": 20, "x2": 100, "y2": 200 }
}
```

The `EventEnvelope` described earlier in the Data Model section is the long-term target. The `Message` struct above is the minimum viable shape that the relay can already route today.

## Current WebSocket Implementation

This section is the source of truth for what the WebSocket layer actually does today. Everything in here must match the code in `backend/internals/websocket/`. The design sections above describe where this is heading; this section describes where it is.

### File Layout

```text
backend/internals/websocket/
  message.go    // Message struct (Type / Room / Content)
  room.go       // Room + RoomManager + GetorCreateRoom / JoinRoom / LeaveRoom / IsMember / Broadcast
  client.go     // Client + HandleMessage + readPump + writePump
  hub.go        // Hub + NewHub + Run (single goroutine that owns hub.clients)
  handler.go    // package-level upgrader + ServeWs
```

Wired up in two places outside the package:

- `cmd/main.go` — creates the single `Hub` and single `RoomManager`, starts `go hub.Run()`, and passes both into `routers.SetupRouter`.
- `internals/routers/router.go` — `SetupRouter(pool, hub, rm)` registers `mux.HandleFunc("/ws", ...)` and wraps the mux in the existing `withCORS` middleware so the React dev server's OPTIONS preflight works.

### Actual Structs (vs Design)

The `EventEnvelope`, the design `Hub`, and the design `Client` are described in the Data Model section above. The structs that exist in code today are smaller — they have no `UserID`, no `RoomID`, no `BoardID`, no `Inbound`, no `Payload`. The room lives in the message envelope, not on the connection.

```go
// internals/websocket/hub.go
type Hub struct {
    clients    map[*Client]bool
    register   chan *Client
    unregister chan *Client
}

// internals/websocket/room.go
type Room struct {
    roomname string
    clients  map[string]*Client
    mu       sync.RWMutex
}

type RoomManager struct {
    rooms map[string]*Room
    mu    sync.RWMutex
}

// internals/websocket/client.go
type Client struct {
    id   uuid.UUID
    conn *websocket.Conn
    send chan []byte
}
```

The room is keyed by name string; the client is keyed inside a room by its UUID. The hub only tracks "is this client connected at all" — it does not know which room the client is in.

### Message Types Actually Supported

Only three client-to-server types and four server-to-client types are wired up today. The richer catalogue below in the `## Event Types` section is design intent.

Client → server:

| `type`    | What it does                                                                   |
| --------- | ------------------------------------------------------------------------------ |
| `join`    | Adds this client to `room` (creates the room if it does not exist).            |
| `leave`   | Removes this client from `room` (deletes the room if it becomes empty).        |
| `message` | Forwards `content` as raw bytes to every other member of `room`.               |

Server → client:

| `type`    | When it is sent                                                |
| --------- | -------------------------------------------------------------- |
| `joined`  | Reply to your own `join`.                                      |
| `left`    | Reply to your own `leave`.                                     |
| `error`   | You tried to `message` a room you had not joined.              |
| `message` | A `message` from another member of the room (raw passthrough). |

The sender never receives its own `message` back. The relay is the only responsibility the server takes on — it does not inspect, validate, persist, or rewrite `content`.

### How A Connection Works (Actual Flow)

```text
1. Browser opens  ws://localhost:8080/ws
2. router hands the request to websocket.ServeWs.
3. ServeWs upgrades HTTP to WebSocket using the package-level upgrader.
4. ServeWs generates a uuid, builds a Client with a buffered send channel,
   and pushes it onto hub.register.
5. Hub.Run goroutine adds the client to hub.clients and logs "Client Connected".
6. ServeWs starts two goroutines for this client:
     readPump  — keeps reading frames from the browser
     writePump — keeps writing frames from client.send to the browser
7. Client sends  { type: "join", room: "design-room" }.
8. readPump calls HandleMessage, which calls RoomManager.JoinRoom.
9. JoinRoom creates the room if needed and stores the client in room.clients.
10. Server replies to the client with  { type: "joined", room: "design-room" }.
11. Another client in the same room sends  { type: "message", room: "design-room", content: {...} }.
12. HandleMessage checks IsMember, then calls RoomManager.Broadcast.
13. Broadcast iterates the room and pushes the raw message bytes into every
    other client's send channel (skipping the sender) using a non-blocking select.
14. writePump on each receiving client writes the bytes to its WebSocket.
15. The sending client does NOT receive its own message back.
16. When the browser tab closes, readPump exits and pushes the client onto hub.unregister.
17. Hub goroutine removes the client from hub.clients and closes client.send.
18. writePump exits when its channel is closed, and the connection is fully torn down.
```

### Concurrency Notes

- `RoomManager.mu` protects the global `rooms` map.
- `Room.mu` protects a single room's `clients` map.
- `Hub.clients` is only ever touched from the `Hub.Run` goroutine, so it needs no mutex.
- `Broadcast` takes a read lock on the room and uses a non-blocking `select` send into each client's channel. If a client's buffer is full, the message is dropped for that client and a warning is logged. This is intentional — it keeps one slow client from blocking the whole room.

### Quick Test

Open two browser tabs and paste this in both consoles. The second tab's `hello` should appear in the first tab.

```js
const ws = new WebSocket("ws://localhost:8080/ws");
ws.onmessage = (e) => console.log("recv:", JSON.parse(e.data));
ws.onopen = () => ws.send(JSON.stringify({ type: "join", room: "demo" }));
setTimeout(() => {
  ws.send(JSON.stringify({
    type: "message",
    room: "demo",
    content: { hello: "world" }
  }));
}, 500);
```

## Event Types

The event types in this section are the design intent for the long-term system. Today, only the three types listed in the [Current WebSocket Implementation](#current-websocket-implementation) section above are wired up. Treat this section as the spec for the event catalogue, not as something the server already understands.

### `presence.joined`

Send this when a user joins the room.

Payload:

```json
{
  "name": "Chetan",
  "color": "#64be75"
}
```

What clients do:

1. Add the user to the participant list.
2. Show their avatar/name in the room panel.

### `presence.left`

Send this when a user leaves the room.

Payload:

```json
{
  "userId": "usr_1"
}
```

What clients do:

1. Remove the user from the participant list.
2. Hide their cursor.

### `presence.cursor`

Send this while a user moves their mouse.

Payload:

```json
{
  "x": 790,
  "y": 140,
  "tool": "pen"
}
```

Important:

Do not save every cursor event forever. Cursor events are temporary presence. Broadcast them, but usually do not persist them.

### `draw.stroke.added`

Send this after the user draws with the pen.

Payload:

```json
{
  "element": {
    "id": "stroke-1",
    "type": "stroke",
    "points": [[74, 80, 0.5], [94, 74, 0.5]],
    "color": "#111111",
    "size": 5
  }
}
```

What clients do:

1. Add the stroke to the page element list.
2. Redraw the canvas.

### `draw.shape.added`

Use this for:

- `line`
- `arrow`
- `rect`
- `ellipse`

Payload:

```json
{
  "element": {
    "id": "rect-1",
    "type": "rect",
    "x": 414,
    "y": 80,
    "width": 54,
    "height": 68,
    "color": "#111111",
    "fill": "#dbeafe",
    "size": 4
  }
}
```

Meaning:

- `color`: border or stroke color
- `fill`: inside color
- `fill: "transparent"` means no fill

### `draw.text.added`

Send this after the user adds text.

Payload:

```json
{
  "element": {
    "id": "text-1",
    "type": "text",
    "x": 132,
    "y": 132,
    "text": "Main Character",
    "color": "#111111",
    "size": 18,
    "width": 180
  }
}
```

Backend should limit text length so users cannot send huge messages.

### `draw.sticky.added`

Send this after the user adds a sticky note.

Payload:

```json
{
  "element": {
    "id": "sticky-1",
    "type": "sticky",
    "x": 184,
    "y": 338,
    "width": 260,
    "height": 150,
    "text": "Write a quick note",
    "color": "#d9a441",
    "fill": "#fef3c7",
    "textColor": "#111111"
  }
}
```

### `element.updated`

Use this when changing existing elements.

Examples:

- move one element
- move multiple selected elements
- change stroke color
- change fill color
- edit text

Payload:

```json
{
  "elementIds": ["rect-1", "ellipse-1"],
  "patch": {
    "deltaX": 24,
    "deltaY": 12,
    "fill": "#dcfce7"
  }
}
```

What clients do:

1. Find every element in `elementIds`.
2. Apply the patch.
3. Redraw the canvas.

For multi-select, using one event is better than sending many separate updates.

### `element.deleted`

Use this when deleting one or more selected elements.

Payload:

```json
{
  "elementIds": ["stroke-1", "rect-1"]
}
```

What clients do:

1. Remove those IDs from the page.
2. Redraw the canvas.

### `page.cleared`

Use this when the user clears the page.

Payload:

```json
{
  "pageId": "page-1"
}
```

What clients do:

1. Remove all elements from that page.
2. Redraw the canvas.

### `history.undo` And `history.redo`

For the beginner version, keep undo and redo local in the frontend.

For a production version, undo and redo should become shared events.

Example:

```json
{
  "targetEventId": "evt_123"
}
```

Production undo is more difficult because every user must agree on the same history.

### `chat.message`

Chat is separate from drawing history.

Payload:

```json
{
  "text": "Questions?"
}
```

Backend rules:

1. User must be joined to the room.
2. Message text cannot be empty.
3. Message text must have a max length.
4. Drawing events must not appear in chat.
5. Chat messages should not be replayed as drawing history.

## Validation Rules

Validation means checking data before trusting it.

The backend should reject:

- unknown `type` values
- events for a room the user has not joined
- events for a board the user cannot access
- events for a missing page
- invalid element IDs
- invalid colors
- text that is too long
- chat from users who are not in the room
- strokes with too many points
- shapes with impossible coordinates or sizes

Recommended beginner limits:

```text
Max chat length: 500 characters
Max text element length: 1000 characters
Max stroke points per event: 500
Max brush size: 64
Min brush size: 1
Allowed colors: hex colors like #111111, plus transparent for fill
```

## Persistence Strategy

There are two common ways to store whiteboard state.

### Event History

Store every accepted drawing event.

Example:

```text
1. draw.stroke.added
2. draw.shape.added
3. element.updated
4. chat.message
```

For drawing, this is very useful because late joiners can replay events.

### Snapshot

Store the final current board state.

Example:

```json
{
  "pageId": "page-1",
  "elements": []
}
```

Snapshots are useful because replaying 10,000 events can be slow.

### Recommended Beginner Approach

Start simple:

1. Store events in memory.
2. Keep `elements` in memory per board/page.
3. When a user joins, send the current `elements`.
4. Later, replace memory storage with a database.

Later database tables could be:

```text
boards
pages
rooms
room_members
events
snapshots
chat_messages
```

## Go Backend Responsibilities

The backend should do these jobs.

### 1. Create Boards

When the frontend calls `POST /api/boards`, create a board and default page.

### 2. Manage Rooms

When the frontend calls join, add the user to the room.

When the frontend calls leave, remove the user.

### 3. Accept WebSocket Connections

Upgrade the request from HTTP to WebSocket.

### 4. Read Messages

Each client needs a read loop:

```text
while connected:
  read websocket message
  parse JSON
  validate event
  send valid event to hub
```

### 5. Write Messages

Each client needs a write loop:

```text
while connected:
  wait for event from Send channel
  write event to websocket
```

### 6. Broadcast Messages

The hub receives one event and forwards it to all connected clients.

```text
event comes in
for every client in room:
  send event to client
```

### 7. Save Events

Before broadcasting, give the event a cursor and save it.

### 8. Replay Missed Events

When a client reconnects with `cursor=184`, send all events after cursor `184`.

### 9. Keep Chat Separate

Chat messages should be stored separately from drawing events. The frontend chat panel should not show drawing activity like "stroke added".

## Frontend Integration Plan

The current frontend is local-only. Later, connect it to the backend like this.

### Step 1: Create Or Load A Board

When the app starts:

```text
GET /api/boards/{boardId}
```

Use the response to fill:

- board title
- pages
- elements
- latest cursor

### Step 2: Join A Room

When the user submits the join room card:

```text
POST /api/rooms/{roomId}/join
```

Save:

- `roomId`
- `userId`
- participants

### Step 3: Open WebSocket

After joining:

```js
const ws = new WebSocket(
  `ws://localhost:8080/ws/rooms/${roomId}/boards/${boardId}?cursor=${lastCursor}`
);
```

As built today, the path is flat — there is no room or board in the URL and no `cursor` query param. The actual call is:

```js
const ws = new WebSocket("ws://localhost:8080/ws");
```

The room is then chosen by sending a `join` message once the socket is open. See the [Current WebSocket Implementation](#current-websocket-implementation) section above for the full protocol.

### Step 4: Send Drawing Events

When the user draws:

```js
ws.send(JSON.stringify({
  id: crypto.randomUUID(),
  type: "draw.stroke.added",
  roomId,
  boardId,
  pageId,
  clientId,
  payload: {
    element
  }
}));
```

### Step 5: Receive Events

When the frontend receives a WebSocket message:

```js
ws.onmessage = (message) => {
  const event = JSON.parse(message.data);

  switch (event.type) {
    case "draw.stroke.added":
      addElement(event.payload.element);
      break;
    case "element.updated":
      updateElements(event.payload.elementIds, event.payload.patch);
      break;
    case "chat.message":
      addChatMessage(event.payload);
      break;
  }
};
```

### Step 6: Leave Room

When the user clicks Leave:

```text
POST /api/rooms/{roomId}/leave
```

Then:

1. close the WebSocket
2. clear participants
3. disable chat input
4. hide remote cursors

## What To Build First

If you are learning Go, build this in small checkpoints.

Status as of today:

| Checkpoint | Topic                                | Status     |
| ---------- | ------------------------------------ | ---------- |
| 1          | `/health` HTTP server                | Skipped (started with the boards stack instead) |
| 2          | `POST/GET /api/boards`               | Done — PostgreSQL via `pgxpool` |
| 3          | `POST /api/rooms/{id}/{join,leave}`  | Not done   |
| 4          | WebSocket connection                 | Done — `/ws` lives in `internals/websocket/handler.go` |
| 5          | `Hub` + room broadcast               | Done — `hub.go` + `room.go` |
| 6          | Event validation                     | Not done (relay is a passthrough today) |
| 7          | Cursors + persistence                | Not done   |
| 8          | Replay missed events                 | Not done   |
| 9          | Replace in-memory with a database    | Not done (events are not stored at all yet) |

### Checkpoint 1

Create a Go HTTP server with:

```text
GET /health
```

Return:

```json
{
  "ok": true
}
```

### Checkpoint 2

Add:

```text
POST /api/boards
GET /api/boards/{boardId}
```

Use in-memory maps.

### Checkpoint 3

Add:

```text
POST /api/rooms/{roomId}/join
POST /api/rooms/{roomId}/leave
```

Still use in-memory maps.

### Checkpoint 4

Add WebSocket connection and echo JSON messages back to the sender.

### Checkpoint 5

Create the `Hub` and broadcast messages to everyone in the same room.

### Checkpoint 6

Validate event types and reject bad events.

### Checkpoint 7

Store events with increasing cursors.

### Checkpoint 8

Replay missed events when users reconnect.

### Checkpoint 9

Replace in-memory storage with a database.

## Common Beginner Mistakes

### Mistake: Putting Drawing Events In Chat

Do not show `draw.stroke.added` in the chat panel. Chat should only show `chat.message`.

### Mistake: Letting Anyone Chat Without Joining

Reject `chat.message` unless the user joined the room.

### Mistake: Trusting The Browser

Do not trust browser-sent `userId`, `cursor`, or `createdAt`.

The server should create those values.

### Mistake: Not Saving History

If you only broadcast events and do not save them, late joiners will see a blank board.

### Mistake: Saving Cursor Events Forever

Mouse cursor movement creates many events. Broadcast cursor presence, but do not store all cursor positions permanently.

## Final Mental Model

Think of the backend like a traffic controller:

```text
Browser: "I drew this line."
Backend: "Is this valid? Is this user allowed? Save it. Send it to everyone."
Other browsers: "I received the line. I will draw it."
```

That is the core of real-time collaborative apps like whiteboards, editors, dashboards, and multiplayer tools.
