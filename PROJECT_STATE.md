# Tunny Game — Project State

## Project Files
| File | Lines | Description |
|------|-------|-------------|
| `server.js` | 815 | Node.js HTTP + WebSocket server with room persistence |
| `script.js` | 940 | Browser client with rotated table view |
| `index.html` | 109 | Single-page HTML |
| `style.css` | 656 | Dark green felt theme with responsive breakpoints |
| `package.json` | 12 | Dependencies: ws@8.16.0 |

## Game Mechanics
- **Cards:** 24-card deck (J, 9, A, 10, K, Q in 4 suits)
- **Teams:** N+S vs E+W
- **Bidding:** HCP points (not suit+level) — J=20, 9=15, A=15, 10=10, K=5, Q=5
- **Trump:** Highest bidder picks one of their 4 cards as trump BEFORE remaining 2 cards dealt
- **Contract level:** bid < 10 → level 1 (target 4 tricks), bid ≥ 10 → level 2 (target 5 tricks)
- **6 hands per session**

## Scoring
| Situation | Points |
|-----------|--------|
| Declaring team makes target (not all 6) | +1 to declaring team |
| Declaring team makes all 6 tricks | +3 to declaring team (1+2) |
| Declaring team goes down | +1 to opposing team |
| Declaring team goes down, opponent wins all 6 | +3 to opposing team (1+2) |

## Implemented Features

### Core Gameplay
- ✅ Bidding phase with HCP buttons (5-14) + Pass
- ✅ Choose trump phase (declarer clicks card)
- ✅ Play phase (6 tricks, must follow suit)
- ✅ J > 9 > A > 10 > K > Q card hierarchy
- ✅ Dummy hand revealed during play

### Multiplayer
- ✅ Room creation/joining via gallery
- ✅ Admin assigns players to N/S/W/E seats
- ✅ Cut for first dealer (highest card wins)
- ✅ Manual dealer rotation (admin button)
- ✅ Room persistence (rooms.json, 30s auto-save, loads on restart)

### UI/UX
- ✅ Table rotation — each player sees themselves at bottom (South)
- ✅ Center overlay bid UI (only current bidder sees buttons)
- ✅ Opponent areas show player names, not card counts
- ✅ Auto-login (localStorage name + server)
- ✅ Responsive design (700px, 500px breakpoints)
- ✅ Scorecard (admin during play, all after session)

### Admin Features
- ✅ Hand review modal after 6 tricks (all hands, proposed score)
- ✅ Confirm & Update Scorecard button
- ✅ Kick player
- ✅ Rotate dealer
- ✅ 2-minute turn timeout with admin takeover modal
- ✅ Pulsing timeout banner

### Special Mechanics
- ✅ Ask trump (defenders reveal suit, card returned to declarer)
- ✅ Play trump (declarer uses pinned trump when void in lead suit)
- ✅ Trump reveal animation (center banner)

## Server Message Handlers
```
create_room, join_room, assign_position, start_game, bid, choose_trump,
play, play_trump, ask_trump, next_hand, reset_game, kick_player,
rotate_dealer, confirm_hand, admin_play
```

## Client Message Handlers
```
room_list, room_joined, room_update, assigned, cut_result, state,
your_turn, bid_made, play_made, trick_won, hand_end, game_over,
game_reset, dealer_rotated, hand_review, player_timed_out,
trump_revealed, error
```

## Game Flow
1. **Login** → Enter name, connect (auto-connect if cached)
2. **Gallery** → Create/join room, wait in unseated list
3. **Room** → Admin assigns players to N/S/W/E seats
4. **Cut** → Admin starts game → highest card = first dealer
5. **Bidding** → Each player bids HCP or passes → highest = declarer
6. **Choose Trump** → Declarer picks card → suit = trump → 2 more cards dealt
7. **Play** → 6 tricks, follow suit, dummy revealed
8. **Hand Review** → Admin sees all hands, confirms score
9. **Score** → hand_end modal → "Next Hand"
10. **Session Complete** → After 6 hands → game_over → scorecard visible to all

## Running Locally
```bash
cd C:\SpringARM\Tunny
start "" /B "C:\Program Files\nodejs\node.exe" server.js
# Server runs on http://localhost:8080
```