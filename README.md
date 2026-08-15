# Tunny Game

Real-time multiplayer card game: Node.js/Express/Socket.IO backend + React frontend. Live at https://tunny-hyderabad.onrender.com

## Rules

- 24 cards (J, 9, A, 10, K, Q in 4 suits ♠♥♦♣); ranking J > 9 > A > 10 > K > Q.
- HCP values: J=30, 9=20, A=15, 10=10, K=5, Q=5 (hand total 340).
- Bidding 50–170 (multiples of 10) plus Pass. The bid stepper (top-left) uses ▲/▼ to adjust by 10 (floor: current high bid + 10, cap 170). Highest bidder is declarer, chooses a trump suit (hidden).
- Scoring is decided by **HCP**, not trick count: if the declarer's team makes the contract they earn 2 points when the winning bid is ≥ 100, else 1; if they fail, the defenders earn double the bid's points (4 or 2). Plus 1 bonus point for a slam (all 340 HCP).
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

- Admin sees no players' hands normally (only card counts) and all played trick cards.
- Admin sees a player's hand when the seat is vacated (mid-game disconnect, `vacatedHands`) or the player has timed out (`timedOutHand`), and can play for that seat via `admin_play`.
- Non-admin players see only their own hand and the dummy's face-up hand. Trump suit is hidden until revealed via **Ask Trump** (available to the declarer's partner or a defender, on their turn, when they can't follow the led suit) or **Play Trump** (declarer only). The trump card is visible to the declarer until played.

## Game flow

`waiting` → `cut` → `bidding` → `trump_selection` → `playing` → `hand_review` → (next hand or `game_over`). Rooms are visible in the public list in any state; a room closes when no players or observers remain (only the admin, or nobody).

## Versioning

The app version is defined in `frontend/public/settings.json` (field `version`). It uses a 3-part scheme, joined with dots:

- **Part 1 (year)** — increments only by calendar year: `2026` → `1`, `2027` → `2`, and so on.
- **Part 2 (month)** — the month of the year when the change is made: `1`–`12`.
- **Part 3 (day + count)** — `ddnn`, where `dd` is the day of the month the change was made and `nn` is a 2-digit counter of changes on that day (`01`..`99`; capped at `99` if more than 99 changes happen in one day).

Example: `1.8.1501` = year 2026, month 8, the 15th day, first change of that day.

Bump the version whenever you make a change and want it versioned. The version is displayed on the login screen, every in-game screen, and the `/instructions` page (the backend reads the same `settings.json` at startup and injects it into the instructions HTML). The frontend fetches `/settings.json` at runtime, so a fresh build is required for the new version to appear.
