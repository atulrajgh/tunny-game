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
const TIMEOUT_MS = 120000;
const SAVE_INTERVAL = 30000;
const ROOMS = {};
const PLAYER_SOCKETS = {}; // playerId -> Set<socketId>

app.use(express.json());

// Serve built frontend if available (keep at bottom so API routes match first)
const frontendBuild = path.join(__dirname, '..', '..', 'frontend', 'build');
const hasFrontendBuild = fs.existsSync(frontendBuild);
if (hasFrontendBuild) {
  app.use(express.static(frontendBuild));
  console.log('Serving frontend build');
}

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
    if (g.state === 'waiting' || g.state === 'cut') list[id] = { id, playerCount: g.players.length, maxPlayers: 4 };
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

  function timeoutStart() {
    const g = game();
    if (!g) return;
    clearTimeout(g._timeout);
    if (g.state !== 'playing' && g.state !== 'bidding') return;
    g._timeout = setTimeout(() => {
      io.to(g.id).emit('player_timed_out', {
        playerId: g.currentPlayer.id, playerName: g.currentPlayer.name
      });
    }, TIMEOUT_MS);
  }

  socket.on('create_room', ({ playerName }) => {
    if (!playerName) return error('Name required');
    const g = new Game();
    const p = g.addPlayer(playerName, true);
    g.roomId = g.id;
    ROOMS[g.id] = g;
    gameId = g.id; playerId = p.id;
    socket.join(g.id); track();
    socket.emit('room_joined', { gameId: g.id, playerId: p.id, isAdmin: true });
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('join_room', ({ gameId: rid, playerName }) => {
    if (!playerName) return error('Name required');
    let g = ROOMS[rid];
    if (!g) { g = new Game(rid); g.roomId = rid; ROOMS[rid] = g; }
    if (g.state !== 'waiting') return error('Game already started');
    if (g.players.length >= 4) return error('Room full');
    const hasAdmin = !!g.admin;
    if (!hasAdmin) return error('No host in this room');
    const p = g.addPlayer(playerName, false);
    gameId = g.id; playerId = p.id;
    socket.join(g.id); track();
    socket.emit('room_joined', { gameId: g.id, playerId: p.id, isAdmin: p.isAdmin });
    io.to(g.id).emit('player_joined', { playerId: p.id, playerName: p.name, isAdmin: p.isAdmin, playerCount: g.players.length });
    io.emit('room_list', getPublicList());
    updateAll();
  });

  socket.on('join_as_spectator', ({ gameId: rid, playerName }) => {
    if (!playerName) return error('Name required');
    const g = ROOMS[rid];
    if (!g) return error('Room not found');
    const s = g.addSpectator(playerName);
    gameId = g.id; playerId = s.id;
    socket.join(g.id); track();
    socket.emit('room_joined', { gameId: g.id, playerId: s.id, isAdmin: false, isSpectator: true });
    io.to(g.id).emit('spectator_joined', { playerId: s.id, playerName: s.name });
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
    clearTimeout(g._timeout);
    if (g.state === 'hand_review') {
      io.to(g.id).emit('hand_end', { handNumber: g.handNumber, scores: g.scores });
    } else { timeoutStart(); }
    updateAll();
  });

  socket.on('play_trump', () => {
    const g = game(); if (!g) return error('Not in a game');
    if (!g.playTrumpCard(playerId)) return error('Cannot play trump now');
    clearTimeout(g._timeout);
    if (g.state === 'hand_review') {
      io.to(g.id).emit('hand_end', { handNumber: g.handNumber, scores: g.scores });
    } else { timeoutStart(); }
    updateAll();
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

  socket.on('admin_play', ({ targetId, card }) => {
    const g = game(); if (!g) return;
    const admin = me(); if (!admin || !admin.isAdmin) return error('Admin only');
    const target = g.getPlayer(targetId);
    if (!target) return;
    g.currentPlayer = target;
    if (card && g.state === 'playing') g.playCard(targetId, card);
    clearTimeout(g._timeout);
    if (g.state === 'hand_review') {
      io.to(g.id).emit('hand_end', { handNumber: g.handNumber, scores: g.scores });
    } else { timeoutStart(); }
    updateAll();
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
      updateAll();
      if (wasAdmin) {
        io.to(g.id).emit('room_closed', { message: 'Admin disconnected — room closed' });
        delete ROOMS[g.id];
      } else if (wasSpectator) {
        io.to(g.id).emit('spectator_left', { playerId, playerName: pName });
        if (g.players.length === 0 && !g.admin) {
          delete ROOMS[g.id];
        }
      } else {
        io.to(g.id).emit('player_left', { playerId, playerName: pName, playerCount: g.players.length });
        if (g.players.length === 0) {
          delete ROOMS[g.id];
        } else if (g.state !== 'waiting') {
          io.to(g.id).emit('error', { message: `${pName} disconnected` });
          setTimeout(() => { if (ROOMS[g.id] && ROOMS[g.id].players.length === 0) delete ROOMS[g.id]; }, 5000);
        }
      }
    }
    io.emit('room_list', getPublicList());
    untrack();
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
