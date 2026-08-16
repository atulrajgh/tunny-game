"use strict";
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const { Game } = require('./gameLogic.js');
const { renderInstructions } = require('./instructions.js');

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
  res.send(renderInstructions(APP_VERSION));
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

  socket.on('new_game', () => {
    const g = game(); if (!g) return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    g.resetForNewGame();
    io.to(g.id).emit('new_game', {});
    io.emit('room_list', getPublicList());
    updateAll();
  });

  // A player or spectator opts back in for the fresh game. Players get their
  // seat restored (previous position if free, else first free); spectators stay
  // spectators. Emits a per-viewer 'rejoined' so the frontend leaves the rejoin
  // prompt; updateAll broadcasts the new state to everyone.
  socket.on('rejoin_game', () => {
    const g = game(); if (!g) return;
    const viewer = me(); if (!viewer) return;
    if (g.state !== 'waiting') return;
    const kind = g.rejoinViewer(viewer.id);
    if (kind) socket.emit('rejoined', { kind });
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
