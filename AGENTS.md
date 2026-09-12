# Tunny Game — Agent Guide

## Project layout

Repo root is `C:\SpringARM\Tunny\`. Two packages:
- `backend/` — Node.js + Express + Socket.IO server, entry: `src/server.js`, port **3001**
- `frontend/` — React (CRA), entry: `src/App.js`, `src/index.js`, port **3000**
- `frontend/public/settings.json` — app version (`version` field), served to the frontend at `/settings.json` and read by the backend at startup for the `/instructions` page (HTML lives in `backend/src/instructions.js`, rendered by `renderInstructions(version)`).

## Commands

```bash
# Dev — two terminals:
cd backend && npm install && npm run dev
cd frontend && npm install && npm start
# Open http://localhost:3000
```

Tests (backend, no extra deps — Node's built-in runner):

```bash
cd backend && npm test
```

No lint, typecheck, or formatter scripts exist. Backend tests live in `backend/tests/` (63 tests across `gameLogic.test.js` and `instructions.test.js` covering deck/cards, bidding, trump, trick resolution, scoring, disconnects, visibility, persistence, instructions render).

## Architecture

- All state is in-memory, persisted to `backend/rooms.json` every 30s. Restart restores rooms but not active games.
- Real-time via Socket.IO WebSockets; REST API at `/api/games` for room listing/creation.
- First player to join a room becomes admin automatically.
- Room lifecycle: rooms visible in public list in any state. A room closes when no players or observers remain (only the admin, or nobody).
- CORS: `origin: "*"` — wide open.

## Game state machine

`waiting` → `cut` → `bidding` → `trump_selection` → (`playing` or `redeal_pending`) → `hand_review` → (next hand or `game_over`)

When the declarer's team (declarer + dummy, including the reserved trump card and any vacated seats) holds all 6 cards of the trump suit after the trump is chosen and cards dealt, the game pauses in `redeal_pending` before the first trick. A message shows on every console and the admin gets a **Redeal** button (`redeal` event → `redealAdmin()`), which re-deals fresh hands and returns to `bidding` with the same dealer. Up to 3 same-dealer redeals are allowed; on the 4th occurrence (`redealCount > 3`) the dealer rotates to the next player and the counter resets, so the game can't stall. `redealPending`/`redealCount` are exposed in `getGameState` (public to all viewers; only the admin can trigger `redeal`).

Game ends when a team reaches/crosses 12 points (WINNING_SCORE). Card ranking: J > 9 > A > 10 > K > Q. 24 cards (6 ranks × 4 suits ♠♥♦♣). Bidding range 50–200 (multiples of 10) plus Pass. HCP values: J=30, 9=18, A=12, 10=10, K=3, Q=2.

Scoring is decided by HCP, not trick count: if the declarer's team makes the contract they earn 2 points when the winning bid is ≥ 100, else 1 point; if they fail, the defending team earns double the bid's points (4 or 2). The winning team earns 2 additional points for a slam (collecting all 300 HCP). HCP↔bid table: 50→150, 60→160, … 200→300 (requirement = bid + 100).

## Login (single global table)

There is one shared table (module `GLOBAL_TABLE`, fallback `ROOMS[g.id]`). First player to join becomes admin; the next four become players; everyone else becomes an observer. On login the frontend emits `create_room` (auto-routes onto the global table). On admin disconnect, the first observer is promoted to admin (`promoteToAdmin`); if no observers, the first player is promoted and their seat is vacated (hand saved to `vacatedHands`). If no players or observers remain (only the admin, or nobody), the room is closed and `GLOBAL_TABLE` reset via `closeRoom` (so a fresh join creates a brand-new table).

Teams: N+S vs E+W. Admin assigns positions in waiting room. Dealer rotates clockwise to the next seat at the start of each new hand (`confirmHand` calls `resetForNextHand(true)`); the admin "Move Dealer" button is available for manual adjustment.

## Start a New Game / Rejoin

The new-game/rejoin flow is currently **removed** (rework pending). On the game-over screen there is no "Start a New Game" button and no "Rejoin" button — it shows the winner, final scores, and a centered Name/Join login box at the bottom (reuses `.login-box`; block-level box centered with `margin: 0 auto`). Pressing **Join** on the game-over screen restarts everything: the server `create_room` handler sees `state === 'game_over'`, calls `g.reset(false)` (admin cleared, all parameters reset — including `vacatedHands`), broadcasts `game_reset` so everyone returns to the login screen, then re-attaches the joiner — who becomes the new admin via `autoJoin` (first viewer to join a table with no admin becomes admin). The admin's **Reset Game** (`reset_game` → `g.reset()` — admin preserved) is the alternative restart path from the admin panel. The server handlers `new_game`/`rejoin_game`, `Game.resetForNewGame()`, `Game.rejoinViewer()`, and the frontend `pendingRejoin` machinery have been deleted; the client→server events `new_game` and `rejoin_game` and the server→client `new_game` and `rejoined` events are removed from the event lists below.

## Admin Panel

Embedded below the game table as a collapsible section (toggle at bottom of action bar). Contains:
- **Host** — sit/stand as a normal player (N/S/E/W buttons for truly free or bot-held seats)
- **Table** — seated players with position, team badge, and kick
- **Gallery** — unseated players with position assign buttons (N/S/E/W) and kick
- **Spectators** — list with promote-to-position buttons
- **Game State** — hand/trick number, state, declarer, bid, trump
- **Bids** — each player's current bid
- **Current Trick** — cards played this trick
- **Scores** — running scores, HCP this hand, tricks this hand
- **Controls** — Move Dealer, Reset Scores, Reset Game, Take Over (timed-out player), Confirm & Next Hand. During `waiting` it shows **Start Game** (`start_game` → `startCut()`) and during `cut` it shows **Determine Dealer** (`cut_done` → `determineDealer()`) — the cut-phase button was renamed from "Start Bidding" so the two start phases don't read as redundant (no logic change).

On mobile (< 768px) the 3-column grid stacks to single column; button sizes increase for touch targets. All admin buttons have `touch-action: manipulation` for reliable Android tap handling.

## Bots & Host (computer players)

- **Bots** are spectators with `isBot: true` in `gameLogic.js`. Max 3 total (`MAX_BOTS`); names are drawn at random from the `BOT_NAMES` pool (any unused one of `Abbot`, `Alex`, `Alicia`, `Bob`, `Bianca`, `Bette`, `Charlie`, `Chica`, `Chelsea`). The admin adds them from the admin panel **Bots** section (`add_bot`) and removes unseated ones with the ✕ button (`remove_bot`). Bot names block human reuse while in use; bots are exempt from the 25-viewer cap (`countViewers` excludes them; `countBots` counts seated + unseated).
- A seated bot fills a real seat and plays automatically — bots never time out. The server drives them 0.8–1.5s after each human turn via `scheduleBots`/`runBotTurn`/`finishBotTurn` (server.js bot-driver block, right after `broadcastState`); the module-level `startTurnTimeout(g)` skips bot seats. Strategy lives in `backend/src/bot.js`: `botAction(g, bot)` inspects state and returns one of `bid`/`pass`/`trump`/`play`/`play_trump`/`ask_then_play`, which the driver applies with the same methods human sockets use.
- Bidding uses 4-card hands (~50 HCP average, max 90), so `decideBid` scales from own strength instead of the 6-card requirement: `target = floor((2*ownHCP − 90)/10)*10`, bid only when `target >= 50` and `> highestBid` (cap 200). `decideTrump` picks the highest-HCP suit and reserves its weakest card. `decidePlay`: lead the strongest card; follow with the lowest winning card else cheapest of the led suit; a non-declarer who can't follow and sees the trump hidden returns `ask_then_play` (reveals, then plays); the declarer returns `play_trump` on the last trick or when they can't follow. **When a partner is already winning the trick** the bot never contests it: it plays the highest card of the led suit (or the strongest non-trump card of another suit if it can't follow), and only plays a trump (reserved card or suit card) if that is all that is left in hand. **When an opponent is winning and the bot cannot follow** it overtrumps with the lowest trump that beats the current best card (a trump beats any non-trump; a higher-rank trump beats a trump); if no trump can win it dumps the cheapest **non-trump** card so trumps are saved for a winnable hand (`pickCannotFollow`).
- **Host dual role**: `adminSit('N'|'S'|'E'|'W')`/`adminLeaveSeat()` sit the host as a normal player (admin pushed into `players`, position/team set) or step back off (mid-game the seat is saved via `vacateSeat`). A host-only admin sees no hands; a seated host is a normal player who sees their own hand (`myPos` in the frontend, not `isAdmin`).
- Humans/host can displace a seated bot even on a full table (net count unchanged). `promoteSpectator`/`setPosition`/`adminSit` refuse a bot displacement of a human but allow a human to take a bot-held seat: `_unseatBot` vacates the seat mid-game (hand/turn saved into `vacatedHands`) and the incoming player inherits the seat state via `restoreSavedState`. Bot rows in the admin panel only offer **truly free** seats (`!gameState.positions[pos]`), so a bot never displaces another bot; bot-held seats stay open only for humans/host so they can still replace a bot.
- Bots are never promoted to admin (`promoteToAdmin` skips `isBot`). Kicking a seated bot (`kick_player`/`demoteToSpectator`) returns it to the spectators and leaves the seat vacated.
- `isBot` rides `getGameState` (players/spectators/me) and `toJSON`/`fromJSON`; persistence also stores the admin's position/team/isBot and re-pushes a seated admin into `players` on restore.
- Room liveness ignores bots: `allPlayersOffline` only considers humans, so ≥1 human online keeps the room alive.

## Player timeout

Timeout is 300 seconds (5 minutes) for a player's turn and 600 seconds (10 minutes) when the admin must act (vacated seat or the admin's own turn) in bidding and playing states. When a player times out, a banner appears allowing the admin to take over their turn via `admin_play`. The timed-out player's hand is exposed to the admin (as `state.timedOutHand`) while it is their turn, so the admin can click their cards, bid for them, or choose trump for a timed-out declarer. `g._timedOutPlayerId` is cleared when that player resumes (bids/plays) or when a new hand starts.

## Mid-game disconnect / Admin take-over / Spectator promotion

When a player disconnects mid-game, their hand, bid, played card, and role (currentPlayer/declarer/dummy) are saved in `vacatedHands` keyed by position. The turn becomes a vacated pseudo-player (`id: null`) at that position, and the admin plays that seat — bidding via `admin_play` with a `position` + `card` (bid number), choosing trump for a vacated declarer, or clicking the seat's saved cards in the table. The game never freezes while the seat stays vacant; vacated seats are re-dealt fresh hands on the next hand. When the admin promotes a spectator to fill the seat, the saved state is restored — cards remain unchanged for other players, and turn/declarer/dummy references are reassigned to the new player object.

- Names held by a vacated seat count as "in use" (`getViewerName` checks `vacatedHands`), so a new join can't reuse a held name — except the vacated player themselves, who may rejoin as a spectator with their old name (revoked-token path).
- When every seated player is offline and no spectators remain (`allPlayersOffline`), the room is closed on the last player's disconnect — so a dead game ends instead of lingering; the same check applies in the admin-grace timer. Bots are ignored by the liveness check — only humans keep the room alive.

## Trump visibility

- Trump suit is hidden from all players and admin until revealed via **Ask Trump** (any non-declarer player — the declarer's partner or a defender — may use it) or by the declarer playing their **Play Trump** card. The admin sees the trump (suit and reserved card) only when it is revealed or when the admin becomes the declarer (i.e. the declarer seat is vacated or the declarer has timed out, so the admin acts for them).
- The trump card lives OUTSIDE the declarer's hand at selection (`hand.splice(idx,1)` in `_selectTrump`), so a normal `play` can never touch it. To play it the declarer uses **Play Trump** (`playTrumpCard`), which plays the reserved card and reveals the trump. Gating in `playTrumpCard`: declarer's turn, card unplayed; before the final trick it must be following AND they hold no led-suit card; on the final trick (`trickNumber >= 5`) it's allowed regardless of led suit or leading (`leadSuit` is set if played as lead).
- When a defender reveals via **Ask Trump** (`askTrump`), the reserved card rejoins the declarer's hand via `rejoinTrumpCard()` so it is then played as a normal card (`trumpCard` set to null). If the declarer seat is vacated, the card is pushed into `vacatedHands[pos].hand`.
- Admin take-over for a vacated/timed-out declarer uses `playVacatedTrump(position)` (or `playTrumpCard(targetId)`) via `admin_play` with `{ trump: true }`; the admin sees the reserved trump card in state only when acting as the declarer (vacated/timed-out declarer) — `trumpCard` in `getGameState` gates on `adminActsDeclarer` (`vacatedHands[declarer.position]` set or `_timedOutPlayerId === declarer.id`), never on `isAdmin` alone.
- `cardCount` for the declarer includes +1 for the reserved unplayed trump card (`getGameState`).
- Until the trump is revealed, cards of the trump suit count as regular cards for trick resolution in `endTrick` (`trumpActive = trumpRevealed && trumpSuit` in `gameLogic.js`) — only the led suit can win. Once revealed, the highest trump card in a trick wins.
- The **Ask Trump** and **Play Trump** buttons are hidden by default. Ask Trump shows for a non-declarer on their turn when they can't follow the led suit and the trump isn't revealed (`isPlaying && !isDeclarer && myPos && !gameState.trumpRevealed && canTrumpAction`, where `myPos` means the viewer holds a seat). Play Trump shows for the declarer on their turn, card unplayed, trump unrevealed, when `isLastTrick (trickNumber === 5) || canTrumpAction` (i.e. following and holding no led-suit card) — the reserved card is displayed as a face-down `TRUMP` slot next to the hand.
- When the trump is visible during play, the state bar shows **who set it** (`Trump: ♥ · set by <declarer name>`) and the declarer's contract progress: `Need <handHCPRequirement(bid)> HCP · made <teamPoints[declarerTeam]>` (`.contract-progress`). Public info — shown to players, admin, and spectators alike. Before the reveal, the setter is still shown — suit-less (`Trump set by <declarer name>`) — on all screens; only the declarer (or admin acting as them) sees the suit form early, since `trumpSuit` stays null for everyone else until revealed.

## Trick display

- The state bar's trick area falls back to the last completed trick when `currentTrick` is empty during `playing` (frontend maps the last `trickHistory` entry to the same shape as `currentTrick`). So a finished trick stays visible until the first card of the next trick replaces it; the winner's entry gets a `.won` gold highlight. Hidden outside `playing` (e.g. hand review has its own table).

## Review screen table & messages

- The hand-review table (`.review-table`, 6 columns) is `Trick | Team Totals | N | S | E | W` — the old `Winner`, `N-S`, and `E-W` columns are gone. One **Team Totals** column sits in **position 2** (right after Trick, before the card columns) and shows only **the trick winner's running cumulative HCP total** per row (`r.ns`/`r.ew`, credited the full trick value to the winning team, matching `teamPoints` semantics) — e.g. `Team Totals | +50 | …` (team name omitted). Per-row `winValue` is `t.winnerPoints` (fallback: `teamPoints['N-S'] + teamPoints['E-W']`). Row color coding is unchanged: `.win-ns` (blue) / `.win-ew` (red) backgrounds plus the gold `trick-winner` ✓ on the winning card. The admin-panel "Current Trick" table (`.ac-trick-table` base, 8 columns) keeps its `Winner`/`N-S`/`E-W` layout with its own grid template; only `.review-table` overrides `grid-template-columns: 48px 92px repeat(4, 1fr)`.
- **All in-game messages live in ONE placeholder `.message-bar`** (amber bar, flex, wrapped) rendered where the old `turn-indicator` sat (between the table and the viewer's hand) and on the review screen. Segments concatenate inside it: connection-loss, error/status toast text, redeal (reason + count + admin **Redeal** button), timeout (**Take Over** button), the current-action line (who is bidding/selecting trump/whose turn, folded in from the removed `.current-action`), and **Your turn!**. The bar renders `null` when no message applies. The standalone fixed `.reconnect-banner`, `.toast.error`, `.redeal-banner`, `.timeout-banner`, `.waiting-banner`, and `.turn-indicator` elements are no longer used on the game/review screens (login screen keeps its own `.toast.error`/`.reconnect-banner`). Old banner CSS classes are retained for other/legacy styling; `UIViewer.js` previews the consolidated bar and the 6-column review table.

## WebSocket events (server → client)

`state`, `room_list`, `room_joined`, `player_joined`, `player_left`, `player_demoted`, `spectator_joined`, `spectator_left`, `spectator_promoted`, `demoted_to_spectator`, `cut_start`, `game_started`, `trump_selection`, `game_playing`, `trump_revealed`, `hand_end`, `next_hand`, `game_over`, `game_reset`, `dealer_rotated`, `player_timed_out`, `admin_changed`, `redeal_pending`, `redealed`, `room_closed`, `error`

## WebSocket events (client → server)

`create_room`, `assign_position`, `start_game`, `cut_done`, `bid`, `choose_trump`, `play`, `play_trump`, `ask_trump`, `confirm_hand`, `kick_player`, `rotate_dealer`, `reset_game`, `admin_play`, `promote_to_player`, `redeal`, `add_bot`, `remove_bot`, `admin_sit`, `admin_stand`

## Key conventions

- Card display format: `rank + suit` (e.g. `J♠`). Red suits (♥♦) render with red color. Cards render with a larger rank/suit (`.card-face`), scaled down responsively.
- Bidding UI is a fixed overlay in the top-left (`bidding-top`) with Pass and a value stepper: ▲/▼ adjust the bid in increments of 10 (cap 200), floored at `max(50, highestBid + 10)` so the bid always exceeds the current high bid; the value button submits.
- `getGameState(playerId)` shows each player only their own hand. The declarer's partner (dummy) is an independent player — their hand is hidden from everyone like any other player's. Each player's seat is rendered as a single dummy-card image showing the card count, not individual cards.
- Admin (host-only, not a seated player) sees **no** players' cards normally — only card counts. The admin sees a player's hand only when that seat is vacated (`vacatedHands`) or that player has timed out (`timedOutHand`). Admin sees the trump suit and reserved trump card only when revealed or when acting as a vacated/timed-out declarer; all played trick cards are always visible. A seated host (`myPos`) is a normal player and sees their own hand.
- Spectators see **no** hands either (not even the dummy's) — only the cards played on the table during a trick (`currentTrick`) and each player's card count (`cardCount`). Trump stays hidden from them until revealed.
- Table view rotates so each player sees themselves at South (bottom).

## Versioning

- The app version lives in `frontend/public/settings.json` (`version` field), 3 parts joined by dots:
  - **Year part**: `2026` → `1`, `2027` → `2`, … (increments only by calendar year)
  - **Month part**: `1`–`12` (month the change was made)
  - **Day+count part**: `ddnn` — `dd` = day of the change, `nn` = `01`..`99` count of changes that day (capped at `99`)
- Example: `1.8.1501` = year 2026, August, the 15th, first change of the day.
- **All dates are computed from UTC** (`getUTCDay`/`getUTCMonth`/`getUTCFullYear`), so developers in different time zones (US CDT, AEST, …) derive the same version for the same change. Never compute the day/month from local time.
- **The version is bumped automatically on every push** — `push-to-github.mjs` runs `node bump-version.mjs` (repo root) before uploading, then appends the new version to the commit body. `bump-version.mjs` reads the current UTC date: if it matches the current version's date it increments `nn`, otherwise it starts a new `dd01`. It always recomputes all three parts (year/month/day) from UTC — it never blindly increments `nn`. Use `node bump-version.mjs --dry-run` to preview the next version. Do NOT bump manually before a push (the script does it).
- The version is displayed on the login screen, all in-game screens (`.version` element), and the `/instructions` page. The frontend fetches `/settings.json` at runtime (a fresh `frontend/build` is needed for the new version to appear); the backend reads `settings.json` at startup (`APP_VERSION` in `server.js`) and injects it into the instructions HTML via `renderInstructions(APP_VERSION)` in `backend/src/instructions.js`.

## Deployment

- **Production URL**: https://tunny-hyderabad.onrender.com
- Render auto-detects Node.js. Build: `cd backend && npm install && cd ../frontend && npm install && npm run build`. Start: `node backend/src/server.js`.
- Backend serves built frontend from `frontend/build/` when directory exists (production).
- Set `PORT` env var via Render (auto-set). No database service needed.

## Commit message convention (pushes via push-to-github.mjs)

- Keep the commit **subject terse** — one line, ≤ ~70 chars, imperative mood (e.g. `Remove contract-level section; extract instructions page`).
- Put the detail in the commit **body** — bullet list of what changed and why.
- `push-to-github.mjs` combines them as `"<subject>\n\n<body>"`, so GitHub lists show the short subject and the full description on the commit page.
- The script bumps the version automatically before pushing (see Versioning) and appends `- Version <n>.<n>.<nnnn>` to the body — do not include the version in `COMMIT_BODY` yourself.
- Update the `COMMIT_SUBJECT`/`COMMIT_BODY` constants in the script before each push.
