# Tunny Game — Agent Guide

## Project layout

All source lives under `springarm/tunny-game/`. Two packages:
- `backend/` — Node.js + Express + Socket.IO server, entry: `src/server.js`, port **3001**
- `frontend/` — React (CRA), entry: `src/App.js`, `src/index.js`, port **3000**

## Commands

```bash
# Dev — two terminals:
cd springarm/tunny-game/backend && npm install && npm run dev
cd springarm/tunny-game/frontend && npm install && npm start
# Open http://localhost:3000

# Production build (from springarm/tunny-game/):
npm install && npm start   # builds frontend, starts backend on PORT
```

No lint, typecheck, or formatter scripts exist. `backend/tests/` is empty; frontend `npm test` is the CRA placeholder with no actual tests.

## Architecture

- All state is in-memory, persisted to `backend/rooms.json` every 30s. Restart restores rooms but not active games.
- Real-time via Socket.IO WebSockets; REST API at `/api/games` for room listing/creation.
- First player to join a room becomes admin automatically.
- Room lifecycle: empty rooms deleted on last disconnect; mid-game disconnects delete room after 5s.
- CORS: `origin: "*"` — wide open.


## Game state machine

`waiting` → `cut` → `bidding` → `trump_selection` → `playing` → `hand_review` → (next hand or `game_over`)

6 hands per game (MAX_HANDS). Card ranking: J > 9 > A > 10 > K > Q. 24 cards (6 ranks × 4 suits ♠♥♦♣). Bidding range 50–140 (multiples of 10) plus Pass. HCP values: J=20, 9=15, A=15, 10=10, K=5, Q=5.

Contract: bid < 10 → level 1 (4 tricks), bid ≥ 10 → level 2 (5 tricks).

Teams: N+S vs E+W. Admin assigns positions in waiting room.

## WebSocket events (server → client)

`state`, `room_list`, `room_joined`, `player_joined`, `player_left`, `cut_start`, `game_started`, `trump_selection`, `game_playing`, `trump_revealed`, `hand_end`, `next_hand`, `game_over`, `game_reset`, `dealer_rotated`, `player_timed_out`, `kicked`, `error`

## WebSocket events (client → server)

`create_room`, `join_room`, `assign_position`, `start_game`, `cut_done`, `bid`, `choose_trump`, `play`, `play_trump`, `ask_trump`, `confirm_hand`, `kick_player`, `rotate_dealer`, `reset_game`, `admin_play`

## Key conventions

- Card display format: `rank + suit` (e.g. `J♠`). Red suits (♥♦) render with red color.
- `getGameState(playerId)` hides non-admin player names as `[Hidden]` and only shows own hand + dummy's face-up hand.
- Admin sees all hands always.
- Table view rotates so each player sees themselves at South (bottom).
- `PROJECT_STATE.md` describes the old monolithic Tunny Bridge — outdated now.

## Deployment

- **Production URL**: TBD (Render)
- Render auto-detects Node.js. Set Build Command and Start Command in the dashboard (see below).
- Backend serves built frontend from `frontend/build/` when directory exists (production).
- Set `PORT` env var via Render (auto-set). No database service needed.
