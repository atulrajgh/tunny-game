# Tunny Game — Agent Guide

## Project layout

Repo root is `C:\SpringARM\Tunny\`. Two packages:
- `backend/` — Node.js + Express + Socket.IO server, entry: `src/server.js`, port **3001**
- `frontend/` — React (CRA), entry: `src/App.js`, `src/index.js`, port **3000**

## Commands

```bash
# Dev — two terminals:
cd backend && npm install && npm run dev
cd frontend && npm install && npm start
# Open http://localhost:3000
```

No lint, typecheck, or formatter scripts exist. `backend/tests/` is empty.

## Architecture

- All state is in-memory, persisted to `backend/rooms.json` every 30s. Restart restores rooms but not active games.
- Real-time via Socket.IO WebSockets; REST API at `/api/games` for room listing/creation.
- First player to join a room becomes admin automatically.
- Room lifecycle: rooms visible in public list in any state. Empty rooms deleted on last disconnect. Mid-game admin disconnect deletes room immediately; non-admin mid-game disconnect saves their hand/state in `vacatedHands` for spectator promotion.
- CORS: `origin: "*"` — wide open.

## Game state machine

`waiting` → `cut` → `bidding` → `trump_selection` → `playing` → `hand_review` → (next hand or `game_over`)

6 hands per game (MAX_HANDS). Card ranking: J > 9 > A > 10 > K > Q. 24 cards (6 ranks × 4 suits ♠♥♦♣). Bidding range 50–140 (multiples of 10) plus Pass. HCP values: J=20, 9=15, A=15, 10=10, K=5, Q=5.

Contract: bid < 100 → level 1 (4 tricks), bid ≥ 100 → level 2 (5 tricks). Scoring: declarer's team earns 1 point if their HCP total ≥ bid, 2 points if ≥ 280 (slam); otherwise defenders earn 1 point (2 if they get all 280).

Teams: N+S vs E+W. Admin assigns positions in waiting room.

## Admin Panel

Embedded below the game table as a collapsible section (toggle at bottom of action bar). Contains:
- **Gallery** — unseated players with position assign buttons (N/S/E/W) and kick
- **Table** — seated players with position, team badge, and kick
- **Spectators** — list with promote-to-position buttons
- **Game State** — hand/trick number, state, level, declarer, bid, trump
- **Bids** — each player's current bid
- **Current Trick** — cards played this trick
- **Scores** — running scores, HCP this hand, tricks this hand
- **Controls** — Reset Game, Take Over (timed-out player), Confirm Hand / End Game
- **All Hands** — every player's cards visible (admin only)

On mobile (< 768px) the 3-column grid stacks to single column; button sizes increase for touch targets. All admin buttons have `touch-action: manipulation` for reliable Android tap handling.

## Player timeout

Timeout is 300 seconds (5 minutes) for bidding and playing states. When a player times out, a banner appears allowing the admin to take over their turn via `admin_play`.

## Mid-game disconnect / Spectator promotion

When a player disconnects mid-game, their hand, bid, played card, and role (currentPlayer/declarer/dummy) are saved in `vacatedHands` keyed by position. When the admin promotes a spectator to fill that seat, the saved state is restored — cards remain unchanged for other players, and turn/declarer/dummy references are reassigned to the new player object.

## Trump visibility

- Trump suit is hidden from non-admin players until either: the declarer uses "Ask Trump" (reveals suit to declarer), or the declarer uses "Play Trump" (reveals suit + card to everyone).
- Admin and declarer always see the trump suit. `trumpRevealed` controls general visibility.

## WebSocket events (server → client)

`state`, `room_list`, `room_joined`, `player_joined`, `player_left`, `spectator_joined`, `spectator_left`, `spectator_promoted`, `cut_start`, `game_started`, `trump_selection`, `game_playing`, `trump_revealed`, `hand_end`, `next_hand`, `game_over`, `game_reset`, `dealer_rotated`, `player_timed_out`, `room_closed`, `kicked`, `error`

## WebSocket events (client → server)

`create_room`, `join_room`, `join_as_spectator`, `assign_position`, `start_game`, `cut_done`, `bid`, `choose_trump`, `play`, `play_trump`, `ask_trump`, `confirm_hand`, `kick_player`, `rotate_dealer`, `reset_game`, `admin_play`, `promote_to_player`

## Key conventions

- Card display format: `rank + suit` (e.g. `J♠`). Red suits (♥♦) render with red color.
- `getGameState(playerId)` hides non-admin player names as `[Hidden]` and only shows own hand + dummy's face-up hand.
- Admin sees all hands always.
- Table view rotates so each player sees themselves at South (bottom).

## Deployment

- **Production URL**: https://tunny-hyderabad.onrender.com
- Render auto-detects Node.js. Build: `cd backend && npm install && cd ../frontend && npm install && npm run build`. Start: `node backend/src/server.js`.
- Backend serves built frontend from `frontend/build/` when directory exists (production).
- Set `PORT` env var via Render (auto-set). No database service needed.
