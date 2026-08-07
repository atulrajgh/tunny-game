"use strict";
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const { Game } = require('./gameLogic.js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3001;
const ROOMS_FILE = path.join(__dirname, '..', 'rooms.json');
const TIMEOUT_MS = 300000;
const SAVE_INTERVAL = 30000;
const ROOMS = {};
const PLAYER_SOCKETS = {}; // playerId -> Set<socketId>
let GLOBAL_TABLE = null;

app.use(express.json());

// Serve built frontend if available (keep at bottom so API routes match first)
const frontendBuild = path.join(__dirname, '..', '..', 'frontend', 'build');
const hasFrontendBuild = fs.existsSync(frontendBuild);
if (hasFrontendBuild) {
  app.use(express.static(frontendBuild));
  console.log('Serving frontend build');
}

// Instructions page
app.get('/instructions', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tunny — Rules</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#1a2a1a;color:#e0e8e0;line-height:1.6;padding:20px}
h1{color:#f0c040;text-align:center;font-size:28px;margin-bottom:8px}
.sub{text-align:center;color:#a0d0a0;margin-bottom:24px}
h2{color:#c0e8c0;margin:20px 0 8px;border-bottom:1px solid #3a5a3a;padding-bottom:4px}
h3{color:#a0d0a0;margin:14px 0 6px}
p,li{color:#d0d8d0;margin-bottom:6px}
ul{padding-left:20px;margin-bottom:12px}
.card{display:inline-block;background:#fff;color:#222;border-radius:4px;padding:1px 6px;font-weight:700;font-size:14px}
.card.red{color:#c0392b}
code{background:#2a3a2a;padding:1px 5px;border-radius:3px;font-size:13px}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{border:1px solid #3a5a3a;padding:6px 10px;text-align:center}
th{background:#2d4a2d;color:#f0c040;font-size:13px}
td{font-size:13px}
.back{display:block;text-align:center;margin:20px 0;font-size:14px}
.back a{color:#f0c040}
@media(min-width:768px){body{max-width:720px;margin:auto}}
</style></head><body>
<h1>♠ TUNNY ♥</h1>
<p class="sub">A 4-player trick-taking card game</p>
<h2>Overview</h2>
<p>Tunny is played by <strong>4 players</strong> in fixed partnerships: <strong>North+South</strong> vs <strong>East+West</strong>. A match ends when the first team reaches <strong>12 points</strong>. Teams score points based on high-card-point (HCP) bidding.</p>

<h2>Cards</h2>
<p>24 cards: 6 ranks × 4 suits. Rank order (high to low):</p>
<p><span class="card">J</span> <span class="card">9</span> <span class="card">A</span> <span class="card">10</span> <span class="card">K</span> <span class="card">Q</span></p>
<p>Each card has an HCP value:</p>
<table><tr><th>Card</th><td><span class="card">J</span></td><td><span class="card">9</span></td><td><span class="card">A</span></td><td><span class="card">10</span></td><td><span class="card">K</span></td><td><span class="card">Q</span></td></tr>
<tr><th>HCP</th><td>30</td><td>20</td><td>15</td><td>10</td><td>5</td><td>5</td></tr></table>
<p>Total HCP in each hand: <strong>340</strong> (4 cards per player × 6).</p>

<h2>Game Flow</h2>
<h3>1. Waiting Room</h3>
<p>Players join and the admin assigns positions (N/S/E/W). Once all 4 seats are filled, the admin can <strong>Start Game</strong>.</p>

<h3>2. Cut</h3>
<p>Each player draws a card. The player with the highest cut card becomes the <strong>dealer</strong>. The first bidder is the player to the dealer's left. The dealer <strong>rotates clockwise</strong> to the next seat at the start of each new hand.</p>

<h3>3. Bidding</h3>
<p>Starting from the player left of the dealer, each player may <strong>Pass</strong> or bid a multiple of <strong>10 between 50 and 170</strong>. The bid panel sits in the <strong>top-left corner</strong> over the scorecard — use the <strong>▲/▼</strong> buttons to raise or lower your bid by 10 (the value can't drop below the current highest bid + 10, and caps at 170), then press the value button to place it. A bid must be higher than the current highest bid. Bidding ends when <strong>3 consecutive passes</strong> follow a bid. If all 4 pass without any bid, the hand is re-dealt with the same dealer.</p>
<p>The winning bidder becomes <strong>declarer</strong>.</p>

<h3>4. Contract Level</h3>
<table><tr><th>Bid</th><th>Level</th><th>Tricks to Win</th></tr>
<tr><td>&lt; 100</td><td>1</td><td>4</td></tr>
<tr><td>≥ 100</td><td>2</td><td>5</td></tr></table>

<h3>5. Trump Selection</h3>
<p>The declarer selects a card from their hand. That card's suit becomes <strong>trump</strong>. The trump card stays face-up in the declarer's hand until played. After selection, the remaining deck cards are dealt.</p>

<h3>6. Play</h3>
<p>Players play tricks clockwise. You must <strong>follow suit</strong> if possible. If you cannot follow suit, you may play any card (including trump). The highest card of the lead suit wins the trick, unless a trump is played — then the highest trump wins.</p>
<p><strong>Trump visibility:</strong> The trump suit is hidden from all players and the admin until it is revealed. Any non-declarer (the declarer's partner or a defender) can use <strong>Ask Trump</strong> to reveal the suit, and the declarer can use <strong>Play Trump</strong> to reveal the suit and play the trump card. The <strong>Ask Trump</strong> and <strong>Play Trump</strong> buttons are hidden by default — they appear only when it is your turn and you do not hold the current trick's led suit in your hand. The trump card is always visible to the declarer (and admin) until played.</p>

<h3>7. Scoring</h3>
<p>After all tricks, the admin reviews and confirms the hand:</p>
<ul>
<li><strong>Declarer's team</strong> wins if their total HCP ≥ bid × 1.5 + 85</li>
<li><strong>Defenders</strong> win if declarer's team fails to meet the bid</li>
<li>The winning team earns <strong>2 points</strong> when the winning bid is <strong>≥ 100</strong> (a level-2 contract), else <strong>1 point</strong></li>
<li>Winning team earns <strong>1 additional point</strong> for a <strong>slam</strong> (collecting all 340 HCP)</li>
</ul>
<p><strong>Bid vs required HCP</strong> (your team must collect at least this many HCP to make the contract):</p>
<table>
<tr><th>Bid</th><td>50</td><td>60</td><td>70</td><td>80</td><td>90</td><td>100</td><td>110</td><td>120</td><td>130</td><td>140</td><td>150</td><td>160</td><td>170</td></tr>
<tr><th>HCP needed</th><td>160</td><td>175</td><td>190</td><td>205</td><td>220</td><td>235</td><td>250</td><td>265</td><td>280</td><td>295</td><td>310</td><td>325</td><td>340</td></tr>
</table>
<p>Example: bidding <strong>100</strong> requires your team to win <strong>235 HCP</strong>; a <strong>170</strong> bid needs all <strong>340 HCP</strong>.</p>

<h2>Winning</h2>
<p>The first team to reach or cross <strong>12 points</strong> wins the match.</p>

<h2>Timeouts &amp; Disconnects</h2>
<ul>
<li>Players have <strong>5 minutes</strong> to bid or play. If they time out, the admin can <strong>Take Over</strong> their turn.</li>
<li>If a player disconnects mid-game, their hand and state are saved. The admin can <strong>promote a spectator</strong> to fill the seat, restoring their saved cards and turn.</li>
<li>If the admin disconnects, the first observer (or player) is promoted to admin. If no players or observers remain, the room is closed and a fresh join starts a brand-new table.</li>
</ul>

<h2>Admin Controls</h2>
<p>The admin panel (collapsible below the game table) provides:</p>
<ul>
<li><strong>Gallery</strong> — unseated players with position assign buttons and kick</li>
<li><strong>Table</strong> — seated players and kick</li>
<li><strong>Spectators</strong> — promote to player</li>
<li><strong>Game State</strong> — hand/trick, state, level, declarer, bid, trump</li>
<li><strong>Bids</strong> — each player's bid</li>
<li><strong>Current Trick</strong> — cards played</li>
<li><strong>Scores</strong> — running scores, HCP, tricks</li>
<li><strong>Controls</strong> — Move Dealer, Reset Scores, Reset Game, Take Over, Confirm Hand</li>
</ul>

<div class="back"><a href="/">← Back to Game</a></div>
</body></html>`);
});

function saveRooms() {
  try {
    const data = {};
    for (const [id, g] of Object.entries(ROOMS)) data[id] = g.toJSON();
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* ignore */ }
}

function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      for (const [id, json] of Object.entries(JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')))) {
        ROOMS[id] = Game.fromJSON(json);
      }
    }
  } catch (e) { /* ignore */ }
}
loadRooms();
setInterval(saveRooms, SAVE_INTERVAL);

function getPublicList() {
  const list = {};
  for (const [id, g] of Object.entries(ROOMS)) {
    list[id] = { id, playerCount: g.players.length + (g.admin ? 1 : 0), maxPlayers: 4 };
  }
  return list;
}

app.get('/api/games', (req, res) => res.json(getPublicList()));
app.post('/api/games', (req, res) => {
  if (!req.body.playerName) return res.status(400).json({ error: 'Name required' });
  const game = new Game();
  game.addPlayer(req.body.playerName, true);
  game.roomId = game.id;
  ROOMS[game.id] = game;
  res.json({ gameId: game.id, state: game.state, playerCount: game.players.length });
});

function emitToPlayer(playerId, event, data) {
  const sockets = PLAYER_SOCKETS[playerId];
  if (sockets) for (const sid of sockets) io.to(sid).emit(event, data);
}

// SPA catch-all — must be after all API routes
if (hasFrontendBuild) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendBuild, 'index.html'));
  });
}

function promoteNewAdmin(g) {
  const a = g.promoteToAdmin();
  if (a) {
    emitToPlayer(a.id, 'state', g.getGameState(a.id));
    // Broadcast to all remaining that a new admin took over
    for (const p of g.players) emitToPlayer(p.id, 'state', g.getGameState(p.id));
    for (const s of g.spectators) emitToPlayer(s.id, 'state', g.getGameState(s.id));
  }
}

function closeRoom(g) {
  delete ROOMS[g.id];
  if (GLOBAL_TABLE === g) GLOBAL_TABLE = null;
  io.to(g.id).emit('room_closed', { message: 'Game room closed' });
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('room_list', getPublicList());
  let gameId = null, playerId = null;

  function error(msg) { socket.emit('error', { message: msg }); }
  function game() { return ROOMS[gameId]; }
  function me() { const g = game(); return g ? g.getViewer(playerId) : null; }

  function track() {
    if (playerId) {
      if (!PLAYER_SOCKETS[playerId]) PLAYER_SOCKETS[playerId] = new Set();
      PLAYER_SOCKETS[playerId].add(socket.id);
    }
  }
  function untrack() {
    if (playerId && PLAYER_SOCKETS[playerId]) {
      PLAYER_SOCKETS[playerId].delete(socket.id);
      if (PLAYER_SOCKETS[playerId].size === 0) delete PLAYER_SOCKETS[playerId];
    }
  }

  function updateAll() {
    const g = game();
    if (!g) return;
    for (const p of g.players) emitToPlayer(p.id, 'state', g.getGameState(p.id));
    if (g.admin) emitToPlayer(g.admin.id, 'state', g.getGameState(g.admin.id));
    for (const s of g.spectators) emitToPlayer(s.id, 'state', g.getGameState(s.id));
  }

  function attachPlayer(g, name, admin) {
    const p = g.addPlayer(name, admin);
    if (!p) return null;
    gameId = g.id; playerId = p.id;
    socket.join(g.id); track();
    socket.emit('room_joined', { gameId: g.id, playerId: p.id, isAdmin: p.isAdmin });
    io.to(g.id).emit('player_joined', { playerId: p.id, playerName: p.name, isAdmin: p.isAdmin, playerCount: g.players.length });
    return p;
  }

  function attachSpectator(g, name) {
    const s = g.addSpectator(name);
    gameId = g.id; playerId = s.id;
    socket.join(g.id); track();
    socket.emit('room_joined', { gameId: g.id, playerId: s.id, isAdmin: false, isSpectator: true });
    io.to(g.id).emit('spectator_joined', { playerId: s.id, playerName: s.name });
    return s;
  }

  function finishTurn(g) {
    clearTimeout(g._timeout);
    if (g.state === 'hand_review') {
      io.to(g.id).emit('hand_end', { handNumber: g.handNumber, scores: g.scores });
    } else { timeoutStart(); }
    updateAll();
  }

  function timeoutStart() {
    const g = game();
    if (!g) return;
    clearTimeout(g._timeout);
    if (g.state !== 'playing' && g.state !== 'bidding') return;
    g._timeout = setTimeout(() => {
      const cp = g.currentPlayer;
      const isAdminGame = !!g.admin;
      g._timedOutPlayerId = cp ? cp.id : null;
      if (isAdminGame && g.admin) {
        emitToPlayer(g.admin.id, 'player_timed_out', {
          playerId: cp ? cp.id : null,
          playerName: cp ? cp.name : 'Unknown (vacant seat)'
        });
      }
    }, TIMEOUT_MS);
  }

  function autoJoin(g, playerName) {
    if (!g.admin) {
      return attachPlayer(g, playerName, true);
    } else if (g.players.length < 4) {
      return attachPlayer(g, playerName, false);
    }
    return attachSpectator(g, playerName);
  }

  socket.on('create_room', ({ playerName }) => {
    if (!playerName) return error('Name required');
    if (!GLOBAL_TABLE) { GLOBAL_TABLE = new Game(); GLOBAL_TABLE.roomId = GLOBAL_TABLE.id; ROOMS[GLOBAL_TABLE.id] = GLOBAL_TABLE; }
    if (!autoJoin(GLOBAL_TABLE, playerName)) return error('Failed to join');
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('join_room', ({ gameId: rid, playerName }) => {
    if (!playerName) return error('Name required');
    let g = ROOMS[rid];
    if (!g) { g = new Game(rid); g.roomId = rid; ROOMS[rid] = g; }
    if (!autoJoin(g, playerName)) return error('Room full');
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('join_as_spectator', ({ gameId: rid, playerName }) => {
    if (!playerName) return error('Name required');
    const g = ROOMS[rid];
    if (!g) return error('Room not found');
    attachSpectator(g, playerName);
    updateAll();
  });

  socket.on('promote_to_player', ({ spectatorId, position }) => {
    const g = game(); if (!g) return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    const p = g.promoteSpectator(playerId, spectatorId, position);
    if (!p) return error('Cannot promote');
    io.to(g.id).emit('spectator_promoted', { playerId: p.id, playerName: p.name });
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('assign_position', ({ playerId: pid, position }) => {
    const g = game(); if (!g) return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    g.setPosition(pid, position);
    updateAll();
  });

  socket.on('start_game', () => {
    const g = game(); if (!g) return error('Not in a game');
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    if (!g.startCut()) return error('Need 4 players with positions');
    io.to(g.id).emit('cut_start', {});
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('cut_done', () => {
    const g = game(); if (!g || g.state !== 'cut') return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    g.determineDealer();
    io.to(g.id).emit('game_started', { dealer: g.dealer.name });
    io.emit('room_list', getPublicList());
    updateAll();
    timeoutStart();
  });

  socket.on('bid', ({ bid }) => {
    const g = game(); if (!g) return error('Not in a game');
    if (!g.placeBid(playerId, bid)) return error('Invalid bid');
    clearTimeout(g._timeout);
    if (g.state === 'trump_selection') {
      io.to(g.id).emit('trump_selection', { playerId: g.declarer.id, playerName: g.declarer.name });
    } else { timeoutStart(); }
    updateAll();
  });

  socket.on('choose_trump', ({ card }) => {
    const g = game(); if (!g) return error('Not in a game');
    if (!g.selectTrump(playerId, card)) return error('Invalid trump selection');
    clearTimeout(g._timeout);
    io.to(g.id).emit('game_playing', { trump: g.trumpSuit });
    timeoutStart();
    updateAll();
  });

  socket.on('play', ({ card }) => {
    const g = game(); if (!g) return error('Not in a game');
    if (!g.playCard(playerId, card)) return error('Invalid play');
    finishTurn(g);
  });

  socket.on('play_trump', () => {
    const g = game(); if (!g) return error('Not in a game');
    if (!g.playTrumpCard(playerId)) return error('Cannot play trump now');
    finishTurn(g);
  });

  socket.on('ask_trump', () => {
    const g = game(); if (!g) return error('Not in a game');
    if (!g.askTrump(playerId)) return error('Cannot ask trump');
    io.to(g.id).emit('trump_revealed', { trumpSuit: g.trumpSuit });
    updateAll();
  });

  socket.on('confirm_hand', () => {
    const g = game(); if (!g) return error('Not in a game');
    if (!g.confirmHand(playerId)) return error('Cannot confirm');
    clearTimeout(g._timeout);
    if (g.state === 'game_over') {
      io.to(g.id).emit('game_over', { winner: g.winner, scores: g.scores });
      io.emit('room_list', getPublicList());
    } else {
      io.to(g.id).emit('next_hand', { handNumber: g.handNumber, dealer: g.dealer.name });
      timeoutStart();
    }
    updateAll();
  });

  socket.on('kick_player', ({ targetId }) => {
    const g = game(); if (!g) return;
    if (!g.kickPlayer(playerId, targetId)) return error('Cannot kick');
    const sockets = PLAYER_SOCKETS[targetId];
    if (sockets) for (const sid of [...sockets]) {
      const s = io.sockets.sockets.get(sid);
      if (s) { s.emit('kicked', {}); s.leave(g.id); }
    }
    delete PLAYER_SOCKETS[targetId];
    io.to(g.id).emit('player_left', { playerId: targetId, playerCount: g.players.length });
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('rotate_dealer', () => {
    const g = game(); if (!g) return;
    if (!g.rotateDealer(playerId)) return error('Admin only');
    io.to(g.id).emit('dealer_rotated', { dealer: g.dealer.name });
    updateAll();
  });

  socket.on('reset_game', () => {
    const g = game(); if (!g) return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    g.reset();
    io.to(g.id).emit('game_reset', {});
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('reset_scores', () => {
    const g = game(); if (!g) return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    g.resetScores(playerId);
    updateAll();
  });

  socket.on('admin_play', ({ targetId, card, position }) => {
    const g = game(); if (!g) return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    if (position) {
      if (g.state === 'playing') {
        if (!card) return error('Pick a card to play');
        if (!g.playVacatedCard(position, card)) return error('Invalid play');
      } else if (g.state === 'bidding') {
        if (card === undefined) return error('Pick a bid');
        if (!g.placeVacatedBid(position, card)) return error('Invalid bid');
      } else if (g.state === 'trump_selection') {
        if (!card) return error('Pick a trump card');
        if (!g.selectVacatedTrump(position, card)) return error('Invalid trump');
      } else {
        return error('Cannot act for vacant seat in this state');
      }
    } else {
      const target = g.getPlayer(targetId);
      if (!target) return error('Player no longer in game');
      g.currentPlayer = target;
      if (card !== undefined && card !== null) {
        if (g.state === 'playing') {
          if (!g.playCard(targetId, card)) return error('Invalid play');
        } else if (g.state === 'bidding') {
          if (!g.placeBid(targetId, card)) return error('Invalid bid');
        } else if (g.state === 'trump_selection') {
          if (!g.selectTrump(targetId, card)) return error('Invalid trump');
        }
      }
    }
    finishTurn(g);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnect:', playerId);
    const g = game();
    if (g && playerId) {
      const wasPlayer = !!g.getPlayer(playerId);
      const wasSpectator = !wasPlayer && !!g.getViewer(playerId);
      const p = g.getViewer(playerId);
      const pName = p?.name || 'Unknown';
      const wasAdmin = p?.isAdmin || false;
      g.removePlayer(playerId);
      // If no players or observers remain, close the room (even if admin is absent)
      if (g.players.length === 0 && g.spectators.length === 0) {
        closeRoom(g);
      } else if (wasAdmin) {
        // Try to promote an observer or player to admin
        promoteNewAdmin(g);
        io.to(g.id).emit('admin_changed', {});
      } else if (wasSpectator) {
        io.to(g.id).emit('spectator_left', { playerId, playerName: pName });
      } else {
        io.to(g.id).emit('player_left', { playerId, playerName: pName, playerCount: g.players.length });
      }
      if (ROOMS[g.id]) updateAll();
    }
    io.emit('room_list', getPublicList());
    untrack();
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
