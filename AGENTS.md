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
- Room lifecycle: rooms visible in public list in any state. A room closes when no players or observers remain (only the admin, or nobody).
- CORS: `origin: "*"` — wide open.

## Game state machine

`waiting` → `cut` → `bidding` → `trump_selection` → `playing` → `hand_review` → (next hand or `game_over`)

Game ends when a team reaches/crosses 12 points (WINNING_SCORE). Card ranking: J > 9 > A > 10 > K > Q. 24 cards (6 ranks × 4 suits ♠♥♦♣). Bidding range 50–170 (multiples of 10) plus Pass. HCP values: J=30, 9=20, A=15, 10=10, K=5, Q=5.

Contract: bid < 100 → level 1 (4 tricks), bid ≥ 100 → level 2 (5 tricks). Scoring: if the declarer's team makes the contract they earn 2 points when the winning bid is ≥ 100 (a level-2 contract), else 1 point; if they fail, the defending team earns double the bid's points (4 or 2). The winning team earns 1 additional point for a slam (collecting all 340 HCP). HCP↔bid table: 50→160, 60→175, 70→190, … 160→325, 170→340.

## Login (single global table)

There is one shared table (module `GLOBAL_TABLE`, fallback `ROOMS[g.id]`). First player to join becomes admin; the next four become players; everyone else becomes an observer. On login the frontend emits `create_room` (auto-routes onto the global table). On admin disconnect, the first observer is promoted to admin (`promoteToAdmin`); if no observers, the first player is promoted and their seat is vacated (hand saved to `vacatedHands`). If no players or observers remain (only the admin, or nobody), the room is closed and `GLOBAL_TABLE` reset via `closeRoom` (so a fresh join creates a brand-new table).

Teams: N+S vs E+W. Admin assigns positions in waiting room. Dealer rotates clockwise to the next seat at the start of each new hand (`confirmHand` calls `resetForNextHand(true)`); the admin "Move Dealer" button is available for manual adjustment.

## Admin Panel

Embedded below the game table as a collapsible section (toggle at bottom of action bar). Contains:
- **Gallery** — unseated players with position assign buttons (N/S/E/W) and kick
- **Table** — seated players with position, team badge, and kick
- **Spectators** — list with promote-to-position buttons
- **Game State** — hand/trick number, state, level, declarer, bid, trump
- **Bids** — each player's current bid
- **Current Trick** — cards played this trick
- **Scores** — running scores, HCP this hand, tricks this hand
- **Controls** — Move Dealer, Reset Scores, Reset Game, Take Over (timed-out player), Confirm & Next Hand

On mobile (< 768px) the 3-column grid stacks to single column; button sizes increase for touch targets. All admin buttons have `touch-action: manipulation` for reliable Android tap handling.

## Player timeout

Timeout is 300 seconds (5 minutes) for a player's turn and 600 seconds (10 minutes) when the admin must act (vacated seat or the admin's own turn) in bidding and playing states. When a player times out, a banner appears allowing the admin to take over their turn via `admin_play`. The timed-out player's hand is exposed to the admin (as `state.timedOutHand`) while it is their turn, so the admin can click their cards, bid for them, or choose trump for a timed-out declarer. `g._timedOutPlayerId` is cleared when that player resumes (bids/plays) or when a new hand starts.

## Mid-game disconnect / Admin take-over / Spectator promotion

When a player disconnects mid-game, their hand, bid, played card, and role (currentPlayer/declarer/dummy) are saved in `vacatedHands` keyed by position. The turn becomes a vacated pseudo-player (`id: null`) at that position, and the admin plays that seat — bidding via `admin_play` with a `position` + `card` (bid number), choosing trump for a vacated declarer, or clicking the seat's saved cards in the table. The game never freezes while the seat stays vacant; vacated seats are re-dealt fresh hands on the next hand. When the admin promotes a spectator to fill the seat, the saved state is restored — cards remain unchanged for other players, and turn/declarer/dummy references are reassigned to the new player object.

## Trump visibility

- Trump suit is hidden from all players and admin until revealed via **Ask Trump** (any non-declarer player — the declarer's partner or a defender — may use it) or by the declarer playing their **Play Trump** card. The admin sees the trump (suit and reserved card) only when it is revealed or when the admin becomes the declarer (i.e. the declarer seat is vacated or the declarer has timed out, so the admin acts for them).
- The trump card lives OUTSIDE the declarer's hand at selection (`hand.splice(idx,1)` in `_selectTrump`), so a normal `play` can never touch it. To play it the declarer uses **Play Trump** (`playTrumpCard`), which plays the reserved card and reveals the trump. Gating in `playTrumpCard`: declarer's turn, card unplayed; before the final trick it must be following AND they hold no led-suit card; on the final trick (`trickNumber >= 5`) it's allowed regardless of led suit or leading (`leadSuit` is set if played as lead).
- When a defender reveals via **Ask Trump** (`askTrump`), the reserved card rejoins the declarer's hand via `rejoinTrumpCard()` so it is then played as a normal card (`trumpCard` set to null). If the declarer seat is vacated, the card is pushed into `vacatedHands[pos].hand`.
- Admin take-over for a vacated/timed-out declarer uses `playVacatedTrump(position)` (or `playTrumpCard(targetId)`) via `admin_play` with `{ trump: true }`; the admin sees the reserved trump card in state only when acting as the declarer (vacated/timed-out declarer) — `trumpCard` in `getGameState` gates on `adminActsDeclarer` (`vacatedHands[declarer.position]` set or `_timedOutPlayerId === declarer.id`), never on `isAdmin` alone.
- `cardCount` for the declarer includes +1 for the reserved unplayed trump card (`getGameState`).
- Until the trump is revealed, cards of the trump suit count as regular cards for trick resolution in `endTrick` (`trumpActive = trumpRevealed && trumpSuit` in `gameLogic.js`) — only the led suit can win. Once revealed, the highest trump card in a trick wins.
- The **Ask Trump** and **Play Trump** buttons are hidden by default. Ask Trump shows for a non-declarer on their turn when they can't follow the led suit and the trump isn't revealed (`isPlaying && !isDeclarer && !isAdmin && !gameState.trumpRevealed && canTrumpAction`). Play Trump shows for the declarer on their turn, card unplayed, trump unrevealed, when `isLastTrick (trickNumber === 5) || canTrumpAction` (i.e. following and holding no led-suit card) — the reserved card is displayed as a face-down `TRUMP` slot next to the hand.

## WebSocket events (server → client)

`state`, `room_list`, `room_joined`, `player_joined`, `player_left`, `player_demoted`, `spectator_joined`, `spectator_left`, `spectator_promoted`, `demoted_to_spectator`, `cut_start`, `game_started`, `trump_selection`, `game_playing`, `trump_revealed`, `hand_end`, `next_hand`, `game_over`, `game_reset`, `dealer_rotated`, `player_timed_out`, `admin_changed`, `room_closed`, `error`

## WebSocket events (client → server)

`create_room`, `join_room`, `join_as_spectator`, `assign_position`, `start_game`, `cut_done`, `bid`, `choose_trump`, `play`, `play_trump`, `ask_trump`, `confirm_hand`, `kick_player`, `rotate_dealer`, `reset_game`, `admin_play`, `promote_to_player`

## Key conventions

- Card display format: `rank + suit` (e.g. `J♠`). Red suits (♥♦) render with red color. Cards render with a larger rank/suit (`.card-face`), scaled down responsively.
- Bidding UI is a fixed overlay in the top-left (`bidding-top`) with Pass and a value stepper: ▲/▼ adjust the bid in increments of 10 (cap 170), floored at `max(50, highestBid + 10)` so the bid always exceeds the current high bid; the value button submits.
- `getGameState(playerId)` shows each player only their own hand plus the dummy's face-up hand. The dummy's hand is rendered as a single dummy-card image showing the card count, not individual cards.
- Admin (host-only, not a seated player) sees **no** players' cards normally — only card counts. The admin sees a player's hand only when that seat is vacated (`vacatedHands`) or that player has timed out (`timedOutHand`). Admin sees the trump suit and reserved trump card only when revealed or when acting as a vacated/timed-out declarer; all played trick cards are always visible.
- Table view rotates so each player sees themselves at South (bottom).

## Deployment

- **Production URL**: https://tunny-hyderabad.onrender.com
- Render auto-detects Node.js. Build: `cd backend && npm install && cd ../frontend && npm install && npm run build`. Start: `node backend/src/server.js`.
- Backend serves built frontend from `frontend/build/` when directory exists (production).
- Set `PORT` env var via Render (auto-set). No database service needed.
