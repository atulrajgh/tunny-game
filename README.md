# Tunny Game

Real-time multiplayer card game: Node.js/Express/Socket.IO backend + React frontend. Live at https://tunny-hyderabad.onrender.com

## Rules

- 24 cards (J, 9, A, 10, K, Q in 4 suits ♠♥♦♣); ranking J > 9 > A > 10 > K > Q. 6 hands per game.
- HCP values: J=30, 9=20, A=15, 10=10, K=5, Q=5 (hand total 340).
- Bidding 50–170 (multiples of 10) plus Pass. The bid stepper (top-left) uses ▲/▼ to adjust by 10 (floor: current high bid + 10, cap 170). Highest bidder is declarer, chooses a trump suit (hidden).
- Contract: bid < 100 → level 1 (4 tricks), bid ≥ 100 → level 2 (5 tricks).
- Scoring: the winning team earns 2 points when the winning bid is ≥ 100 (level-2 contract), else 1, plus 1 additional point for a slam (collecting all 340 HCP). The declarer's team wins if their HCP total ≥ `bid*1.5+85`; otherwise the defending team wins.
- Teams: N+S vs E+W. Admin (host, does not play) assigns positions and coordinates.
- Single global table: first to join is admin, next four become players, everyone else an observer.

## Architecture

- `backend/` — Express + Socket.IO server (port 3001). All state in-memory, persisted to `backend/rooms.json` every 30s. Entry: `src/server.js`, game rules in `src/gameLogic.js`.
- `frontend/` — React (CRA, port 3000). Entry: `src/App.js`, `src/index.js`. Styling in `src/index.css`.
- REST API at `/api/games` for room listing/creation; real-time via Socket.IO WebSockets.
- In production the backend serves the built frontend from `frontend/build/` when present.

## Development

Two terminals:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm start
# open http://localhost:3000
```

## Deployment (Render)

`render.yaml` auto-deploys the `main` branch. Build: `cd backend && npm install && cd ../frontend && npm install && npm run build`. Start: `node backend/src/server.js`. Set `PORT` via Render; no database service needed.

## Admin visibility

- Admin sees no players' hands normally (only card counts), the trump suit, and all played trick cards.
- Admin sees a player's hand when the seat is vacated (mid-game disconnect, `vacatedHands`) or the player has timed out (`timedOutHand`), and can play for that seat via `admin_play`.
- Non-admin players see only their own hand and the dummy's face-up hand. Trump suit is hidden until revealed via **Ask Trump** (available to the declarer's partner or a defender, on their turn, when they can't follow the led suit) or **Play Trump** (declarer only). The **Ask Trump** / **Play Trump** buttons are hidden by default and only appear on your turn when you don't hold the current trick's led suit. The trump card is visible to the declarer until played.

## Game flow

`waiting` → `cut` → `bidding` → `trump_selection` → `playing` → `hand_review` → (next hand or `game_over`). Rooms are visible in the public list in any state; a room closes when no players or observers remain (only the admin, or nobody).
