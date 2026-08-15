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
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] }, pingInterval: 45000 });

const PORT = process.env.PORT || 3001;
const ROOMS_FILE = path.join(__dirname, '..', 'rooms.json');
const TIMEOUT_MS = 300000;
const ADMIN_TIMEOUT_MS = 600000;
const ADMIN_GRACE_MS = 60000;
const SAVE_INTERVAL = 30000;
const ROOMS = {};
const PLAYER_SOCKETS = {}; // playerId -> Set<socketId>
const ADMIN_GRACE_TIMERS = {}; // adminId -> timeout (deferred admin promotion on disconnect)
let GLOBAL_TABLE = null;

// App version (see frontend/public/settings.json). Bump per scheme: <yearPart>.<month>.<ddnn>.
const SETTINGS_FILE = path.join(__dirname, '..', '..', 'frontend', 'public', 'settings.json');
let APP_VERSION = '1.0.0';
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    APP_VERSION = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).version || APP_VERSION;
  }
} catch (e) { console.error('load settings.json failed:', e); }

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
.version{text-align:center;color:#a0d0a0;font-size:13px;margin:24px 0 4px}
@media(min-width:768px){body{max-width:720px;margin:auto}}
</style></head><body>
<h1>♠ TUNNY ♥</h1>
<p class="sub">A 4-player partnership trick-taking card game</p>

<h2>Overview</h2>
<p>Tunny is played by <strong>4 players</strong> in fixed partnerships: <strong>North + South</strong> vs <strong>East + West</strong>. The first team to reach <strong>12 points</strong> wins the match. Teams earn points by bidding on their hand's strength, then trying to make (or beat) the contract.</p>

<h2>The Cards</h2>
<p>Each hand uses a 24-card deck: <strong>6 ranks × 4 suits</strong> (♠ ♥ ♦ ♣). Rank order, high to low:</p>
<p><span class="card">J</span> <span class="card">9</span> <span class="card">A</span> <span class="card">10</span> <span class="card">K</span> <span class="card">Q</span></p>
<p>Each card has a high-card-point (HCP) value:</p>
<table><tr><th>Card</th><td><span class="card">J</span></td><td><span class="card">9</span></td><td><span class="card">A</span></td><td><span class="card">10</span></td><td><span class="card">K</span></td><td><span class="card">Q</span></td></tr>
<tr><th>HCP</th><td>30</td><td>20</td><td>15</td><td>10</td><td>5</td><td>5</td></tr></table>
<p>Total HCP in each hand: <strong>340</strong>.</p>

<h2>Game Flow</h2>
<h3>1. Waiting Room</h3>
<p>The first player to join becomes the <strong>admin</strong>; the next four players fill the N/S/E/W seats, and anyone after that joins as a <strong>spectator</strong>. The admin assigns positions and starts the game once all four seats are filled.</p>

<h3>2. Cut</h3>
<p>Each player draws a card. The player with the highest cut card becomes the <strong>dealer</strong>, and the player to their left bids first. The dealer rotates clockwise to the next seat at the start of each new hand (the admin can also move the dealer manually).</p>

<h3>3. Bidding</h3>
<p>Starting with the player left of the dealer, each player either <strong>Passes</strong> or bids a multiple of <strong>10 between 50 and 170</strong>. Each bid must be higher than the current highest bid. The bidding panel appears in the <strong>top-left corner</strong>: use <strong>▲/▼</strong> to adjust your bid in steps of 10 (from the highest current bid + 10, up to a cap of 170), then press the value button to submit it.</p>
<p>Bidding ends after <strong>3 consecutive passes</strong> following a bid. If everyone passes, the hand is re-dealt with the same dealer. The winning bidder becomes the <strong>declarer</strong>.</p>

<h3>4. Contract Level</h3>
<p>The contract level determines how many tricks the declarer's team must win:</p>
<table><tr><th>Bid</th><th>Level</th><th>Tricks Needed</th></tr>
<tr><td>&lt; 100 (50–90)</td><td>1</td><td>4</td></tr>
<tr><td>≥ 100 (100–170)</td><td>2</td><td>5</td></tr></table>

<h3>5. Trump Selection</h3>
<p>The declarer selects one card from their hand. That card's suit becomes <strong>trump</strong>. The selected card is set aside from the declarer's hand and is visible only to the declarer until it is played or the trump is revealed. The remaining deck is then dealt out.</p>

<h3>6. Play</h3>
<p>Players play tricks clockwise, following the lead suit whenever possible. If you cannot follow suit, you may play any card, including a trump. The highest card of the lead suit wins the trick unless a trump is played — then the highest trump wins. The dummy (declarer's partner) plays as directed.</p>
<p><strong>Trump visibility:</strong> The trump suit is hidden from everyone (players and admin) until it is revealed. The admin sees the trump only when it is revealed or when the admin is acting as the declarer.</p>
<ul>
<li><strong>Ask Trump</strong> — any non-declarer player (the declarer's partner or a defender) may reveal the trump on their turn when they cannot follow the led suit. The reserved trump card then rejoins the declarer's hand as a normal card.</li>
<li><strong>Play Trump</strong> — the declarer may play the reserved trump card to reveal the trump, but only when following a led suit while holding no card of that suit (never while leading), except on the <strong>final trick of a hand</strong>, where it is always available.</li>
</ul>
<p>Until the trump is revealed, trump-suit cards count as ordinary cards and cannot beat the led suit; once revealed, the highest trump in a trick wins.</p>

<h3>7. Scoring</h3>
<p>When all tricks are done, the admin reviews the hand and confirms it.</p>
<ul>
<li>If the declarer's team makes the contract, they earn <strong>2 points</strong> when the winning bid is <strong>≥ 100</strong> (a level-2 contract), otherwise <strong>1 point</strong>.</li>
<li>If the declarer's team fails, the defending team earns <strong>double the bid's points</strong> (4 points for a level-2 bid, 2 otherwise).</li>
<li>The winning team also earns <strong>1 bonus point</strong> for a <strong>slam</strong> — collecting all 340 HCP.</li>
</ul>
<p><strong>Bid vs. required HCP</strong> (the minimum HCP the declarer's team must collect):</p>
<table>
<tr><th>Bid</th><td>50</td><td>60</td><td>70</td><td>80</td><td>90</td><td>100</td><td>110</td><td>120</td><td>130</td><td>140</td><td>150</td><td>160</td><td>170</td></tr>
<tr><th>HCP needed</th><td>160</td><td>175</td><td>190</td><td>205</td><td>220</td><td>235</td><td>250</td><td>265</td><td>280</td><td>295</td><td>310</td><td>325</td><td>340</td></tr>
</table>
<p>Example: a <strong>100</strong> bid requires 235 HCP; a <strong>170</strong> bid requires all 340 HCP — otherwise the defending team wins.</p>

<h2>Winning the Match</h2>
<p>The first team to reach or cross <strong>12 points</strong> wins.</p>

<h2>Timeouts &amp; Disconnects</h2>
<ul>
<li>Players have <strong>5 minutes</strong> for a turn (10 minutes when the admin must act). On timeout the admin can <strong>Take Over</strong> the seat — bidding, choosing trump, or playing that player's cards for them.</li>
<li>If a player disconnects mid-game, their hand and state are saved. The admin can <strong>promote a spectator</strong> to fill the seat and restore their turn; until then, the admin can play that seat.</li>
<li>If the admin disconnects, the first spectator (or player) is promoted to admin. If only the admin remains, the room closes and a fresh join starts a new table.</li>
</ul>

<h2>Admin Controls</h2>
<p>The collapsible admin panel below the table includes:</p>
<ul>
<li><strong>Gallery</strong> — unseated players, with position assign and kick</li>
<li><strong>Table</strong> — seated players with team badges and kick</li>
<li><strong>Spectators</strong> — promote a spectator to a seat</li>
<li><strong>Game State</strong> — hand/trick, state, level, declarer, bid, trump</li>
<li><strong>Bids</strong> — each player's bid</li>
<li><strong>Current Trick</strong> — cards played</li>
<li><strong>Scores</strong> — running scores, HCP, tricks</li>
<li><strong>Controls</strong> — Move Dealer, Reset Scores, Reset Game, Take Over, Confirm & Next Hand</li>
</ul>

<div class="back"><a href="/">← Back to Game</a></div>
<div class="version">Version ${APP_VERSION}</div>
</body></html>`);
});

function saveRooms() {
  try {
    const data = {};
    for (const [id, g] of Object.entries(ROOMS)) data[id] = g.toJSON();
    const tmp = ROOMS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, ROOMS_FILE);
  } catch (e) { console.error('saveRooms failed:', e); }
}

function loadRooms() {
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      for (const [id, json] of Object.entries(JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')))) {
        const g = Game.fromJSON(json);
        if (!g.players.length) continue;
        // Skip rooms nobody can play in anymore (restored players/spectators are
        // offline) so dead tables don't linger after a restart.
        if (allPlayersOffline(g)) continue;
        ROOMS[id] = g;
      }
    }
  } catch (e) { console.error('loadRooms failed:', e); }
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

function startAdminGrace(g, adminId) {
  if (ADMIN_GRACE_TIMERS[adminId]) return;
  const roomId = g.id;
  ADMIN_GRACE_TIMERS[adminId] = setTimeout(() => {
    delete ADMIN_GRACE_TIMERS[adminId];
    const gg = ROOMS[roomId];
    if (!gg) return;
    if (gg.getPlayer(adminId)) gg.removePlayer(adminId);
    if (allPlayersOffline(gg)) {
      closeRoom(gg);
    } else {
      promoteNewAdmin(gg);
      io.to(g.id).emit('admin_changed', {});
    }
    io.emit('room_list', getPublicList());
  }, ADMIN_GRACE_MS);
}

function clearAdminGrace(adminId) {
  if (ADMIN_GRACE_TIMERS[adminId]) {
    clearTimeout(ADMIN_GRACE_TIMERS[adminId]);
    delete ADMIN_GRACE_TIMERS[adminId];
  }
}

// True when nobody can play anymore: every seated player is offline (or the seats
// are all vacated) and no spectator is online — only the admin is left, so the room
// should close so a fresh join starts a brand-new table.
function allPlayersOffline(g) {
  return !g.players.some(p => p.online !== false) && !g.spectators.some(s => s.online !== false);
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
    const cp = g.currentPlayer;
    const isAdminTurn = !cp || cp.id === null || (g.admin && cp.id === g.admin.id);
    g._timeout = setTimeout(() => {
      const isAdminGame = !!g.admin;
      const tViewer = cp ? g.getViewer(cp.id) : null;
      const offline = cp && cp.id && tViewer && tViewer.online === false;
      // Reconnect window closed for an offline player: vacate the seat and revoke the token.
      if (offline) {
        g.vacateTimedOutPlayer(cp.id);
        g._timedOutPlayerId = null;
        io.emit('room_list', getPublicList());
        updateAll();
      } else {
        g._timedOutPlayerId = cp ? cp.id : null;
      }
      if (isAdminGame && g.admin) {
        emitToPlayer(g.admin.id, 'player_timed_out', {
          playerId: offline ? null : (cp ? cp.id : null),
          playerName: cp ? cp.name : 'Unknown (vacant seat)'
        });
      }
    }, isAdminTurn ? ADMIN_TIMEOUT_MS : TIMEOUT_MS);
  }

  function autoJoin(g, playerName) {
    if (!g.admin) {
      return attachPlayer(g, playerName, true);
    } else if (g.players.length < 4) {
      return attachPlayer(g, playerName, false);
    }
    return attachSpectator(g, playerName);
  }

  function joinError(g, playerName) {
    const name = String(playerName || '').trim();
    if (!name) return 'Name required';
    if (name.length > 20) return 'Name must be 20 characters or less';
    if (g.getViewerName(name)) return 'That name is already taken';
    if (g.countViewers() >= 25) return 'Room is full (max 25 people)';
    return null;
  }

  socket.on('create_room', ({ playerName, playerId: token }) => {
    if (!playerName) return error('Name required');
    if (!GLOBAL_TABLE) { GLOBAL_TABLE = new Game(); GLOBAL_TABLE.roomId = GLOBAL_TABLE.id; ROOMS[GLOBAL_TABLE.id] = GLOBAL_TABLE; }
    const clean = String(playerName || '').trim();
    // Reconnect with a valid token: rebind the existing viewer (admin, player, or spectator).
    if (token) {
      const existing = GLOBAL_TABLE.getViewer(token);
      if (existing && existing.name.toLowerCase() === clean.toLowerCase()) {
        gameId = GLOBAL_TABLE.id; playerId = existing.id;
        socket.join(gameId); track();
        existing.online = true;
        clearAdminGrace(playerId);
        socket.emit('room_joined', { gameId: gameId, playerId: playerId, isAdmin: existing.isAdmin, isSpectator: !!GLOBAL_TABLE.spectators.find(s => s.id === existing.id) });
        io.to(gameId).emit('player_joined', { playerId: playerId, playerName: existing.name, isAdmin: existing.isAdmin, playerCount: GLOBAL_TABLE.players.length });
        updateAll();
        return;
      }
      // Token was revoked (seat reassigned): rejoin as spectator only.
      if (GLOBAL_TABLE.isTokenRevoked(token)) {
        const err = joinError(GLOBAL_TABLE, clean);
        // Their own vacated seat now holds the name, so let them back in as a spectator
        // rather than rejecting them.
        const selfVacated = Object.values(GLOBAL_TABLE.vacatedHands).some(
          v => v.playerName && v.playerName.toLowerCase() === clean.toLowerCase());
        if (err && !selfVacated) return error(err);
        attachSpectator(GLOBAL_TABLE, clean);
        io.emit('room_list', getPublicList());
        updateAll();
        return;
      }
    }
    const err = joinError(GLOBAL_TABLE, clean);
    if (err) return error(err);
    autoJoin(GLOBAL_TABLE, clean);
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('join_room', ({ gameId: rid, playerName }) => {
    if (!playerName) return error('Name required');
    let g = ROOMS[rid];
    if (!g) { g = new Game(rid); g.roomId = rid; ROOMS[rid] = g; }
    const err = joinError(g, playerName);
    if (err) return error(err);
    autoJoin(g, playerName);
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('join_as_spectator', ({ gameId: rid, playerName }) => {
    if (!playerName) return error('Name required');
    const g = ROOMS[rid];
    if (!g) return error('Room not found');
    const err = joinError(g, playerName);
    if (err) return error(err);
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
    const uid = me(); if (!uid || !uid.isAdmin) return error('Admin only');
    const p = g.demoteToSpectator(uid.id, targetId);
    if (!p) return error('Cannot move player to spectator');
    const sockets = PLAYER_SOCKETS[targetId];
    if (sockets) for (const sid of [...sockets]) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit('demoted_to_spectator', {});
    }
    io.to(g.id).emit('player_demoted', { playerId: targetId, playerName: p.name, playerCount: g.players.length });
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

  socket.on('admin_play', ({ targetId, card, position, trump }) => {
    const g = game(); if (!g) return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    if (position) {
      if (g.state === 'playing') {
        if (trump) {
          if (!g.playVacatedTrump(position)) return error('Cannot play trump now');
        } else {
          if (!card) return error('Pick a card to play');
          if (!g.playVacatedCard(position, card)) return error('Invalid play');
        }
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
      if (trump) {
        if (g.state !== 'playing' || !g.playTrumpCard(targetId)) return error('Cannot play trump now');
      } else if (card !== undefined && card !== null) {
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
    const isLastSocket = !PLAYER_SOCKETS[playerId] || PLAYER_SOCKETS[playerId].size <= 1;
    if (g && playerId && isLastSocket) {
      const viewer = g.getViewer(playerId);
      const wasPlayer = !!g.getPlayer(playerId);
      const wasSpectator = !wasPlayer && !!viewer;
      const wasAdmin = viewer?.isAdmin || false;
      const pName = viewer?.name || 'Unknown';
      if (viewer) viewer.online = false;
      if (wasAdmin) {
        // Defer promotion so a quick refresh keeps the same admin (reconnect clears the grace).
        startAdminGrace(g, playerId);
        io.to(g.id).emit('player_left', { playerId, playerName: pName, playerCount: g.players.length, reconnecting: true });
        if (ROOMS[g.id]) updateAll();
      } else if (wasPlayer && g.state !== 'waiting') {
        // Cut/bidding/trump/playing/review: hold the seat. The reconnect window stays open
        // until the 300s turn timeout fires for this player (then vacate + revoke) or the
        // admin kicks/promotes someone into the seat.
        io.to(g.id).emit('player_left', { playerId, playerName: pName, playerCount: g.players.length, reconnecting: true });
        // If every player is now gone and nobody is watching, end the room so a
        // fresh join creates a brand-new table instead of a dead, stuck game.
        if (allPlayersOffline(g)) {
          closeRoom(g);
        } else if (ROOMS[g.id]) {
          updateAll();
        }
      } else {
        // Waiting-state player or spectator: existing immediate removal.
        g.removePlayer(playerId);
        if (g.players.length === 0 && g.spectators.length === 0) {
          closeRoom(g);
        } else if (wasAdmin) {
          promoteNewAdmin(g);
          io.to(g.id).emit('admin_changed', {});
        } else if (wasSpectator) {
          io.to(g.id).emit('spectator_left', { playerId, playerName: pName });
        } else {
          io.to(g.id).emit('player_left', { playerId, playerName: pName, playerCount: g.players.length });
        }
        if (ROOMS[g.id]) updateAll();
      }
    }
    io.emit('room_list', getPublicList());
    untrack();
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
