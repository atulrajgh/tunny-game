"use strict";
const { v4: uuidv4 } = require('uuid');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['J', '9', 'A', '10', 'K', 'Q'];
const RANK_ORDER = { J: 6, 9: 5, A: 4, 10: 3, K: 2, Q: 1 };
const HCP_VALUES = { J: 30, 9: 18, A: 12, 10: 10, K: 3, Q: 2 };
const WINNING_SCORE = 12;
// Human-style names drawn at random (any unused one) for computer players.
const BOT_NAMES = ['Abbot', 'Alex', 'Alicia', 'Bob', 'Bianca', 'Bette', 'Charlie', 'Chica', 'Chelsea'];
const MAX_BOTS = 3;
function bidRequirement(bid) {
  return bid + 100;
}

class Card {
  constructor(suit, rank) {
    this.suit = suit;
    this.rank = rank;
  }
  toString() { return `${this.rank}${this.suit}`; }
  get hcp() { return HCP_VALUES[this.rank] || 0; }
  equals(other) { return other && this.suit === other.suit && this.rank === other.rank; }
}

class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.position = null;
    this.hand = [];
    this.bid = null;
    this.isAdmin = false;
    this.playedCard = null;
    this.score = 0;
    this.cutCard = null;
    this.team = null;
    this.online = true;
    this.isBot = false;
  }
}

class Game {
  constructor(roomId) {
    this.id = roomId || uuidv4();
    this.players = [];
    this.state = 'waiting';
    this.dealer = null;
    this.currentPlayer = null;
    this.declarer = null;
    this.dummy = null;
    this.trumpSuit = null;
    this.trumpCard = null;
    this.trumpCardIndex = -1;
    this.trumpRevealed = false;
    this.trumpCardPlayed = false;
    this.currentTrick = [];
    this.trickHistory = [];
    this.leadSuit = null;
    this.trickNumber = 0;
    this.handNumber = 0;
    this.deck = [];
    this.lastBidder = null;
    this.highestBid = null;
    this.passCount = 0;
    this.scores = { 'N-S': 0, 'E-W': 0 };
    this.teamTricks = { 'N-S': 0, 'E-W': 0 };
    this.teamPoints = { 'N-S': 0, 'E-W': 0 };
    this.winner = null;
    this.admin = null;
    this.adminId = null;
    this.spectators = [];
    this.positions = {};
    this.vacatedHands = {};
    this.roomId = null;
    this.lastActivity = Date.now();
    this._timedOutPlayerId = null;
    this.revokedTokens = new Set();
    this.redealCount = 0;
    this.redealPending = null;
  }

  setupDeck() {
    this.deck = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.deck.push(new Card(suit, rank));
      }
    }
    this.shuffle();
  }

  shuffle() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  addPlayer(name, isAdmin = false) {
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) return null;
    if (this.getViewerName(clean)) return null;
    if (this.countViewers() >= 25) return null;
    const player = new Player(uuidv4(), clean);
    player.isAdmin = isAdmin;
    if (isAdmin) {
      if (this.admin) return null;
      this.admin = player;
      this.adminId = player.id;
    } else {
      this.players.push(player);
    }
    this.lastActivity = Date.now();
    return player;
  }

  // Save a seated player's game state so their seat can be re-filled later.
  vacateSeat(player) {
    const pid = player.id;
    const pos = player.position;
    this.vacatedHands[pos] = {
      id: null,
      originalPlayerId: pid,
      playerName: player.name,
      position: pos,
      hand: [...player.hand],
      team: player.team,
      bid: player.bid,
      playedCard: player.playedCard,
      wasCurrentPlayer: this.currentPlayer && this.currentPlayer.id === pid,
      wasDeclarer: this.declarer && this.declarer.id === pid,
      wasDummy: this.dummy && this.dummy.id === pid,
    };
    if (this.vacatedHands[pos].wasCurrentPlayer &&
        (this.state === 'playing' || this.state === 'bidding' || this.state === 'trump_selection')) {
      this.currentPlayer = this.vacatedPseudo(pos);
    }
    // Seat-role references follow the seat, not the platform object. When the dealer,
    // declarer or dummy leaves the seat, re-point them at the vacated pseudo so
    // seatAfter(dealer.position), the auction/trump logic and turn rotation keep
    // working until a human refills the seat (restoreSavedState re-points on refill).
    // Without this, seating churn (bots -> humans) left dealer.position === null and
    // seatAfter(null) returned null — a 'playing' game with no currentPlayer, which
    // surfaces as a frozen "Someone's turn" with nobody able to act.
    const rolePseudo = this.vacatedPseudo(pos);
    if (this.dealer && this.dealer.id === pid) this.dealer = rolePseudo;
    if (this.declarer && this.declarer.id === pid) this.declarer = rolePseudo;
    if (this.dummy && this.dummy.id === pid) this.dummy = rolePseudo;
    this.lastActivity = Date.now();
  }

  removePlayer(playerId) {
    if (this.admin && this.admin.id === playerId) {
      this.admin = null;
      this.adminId = null;
      // Fall through to also remove from players[] and save hand
    }
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx !== -1) {
      const p = this.players[idx];
      if (this.state !== 'waiting' && p.position) {
        this.vacateSeat(p);
      }
      this.players.splice(idx, 1);
      for (const [pos, id] of Object.entries(this.positions)) {
        if (id === playerId) delete this.positions[pos];
      }
      this.lastActivity = Date.now();
      return true;
    }
    return this.removeSpectator(playerId);
  }

  promoteToAdmin() {
    let candidate = null;
    // Bots are never promoted to admin — only humans can host.
    const spectatorIdx = this.spectators.findIndex(s => !s.isBot);
    if (spectatorIdx !== -1) {
      candidate = this.spectators.splice(spectatorIdx, 1)[0];
    } else {
      const playerIdx = this.players.findIndex(p => !p.isBot);
      if (playerIdx !== -1) {
        const player = this.players[playerIdx];
        if (this.state !== 'waiting' && this.state !== 'cut' && player.position) {
          this.vacateSeat(player);
        }
        for (const [pos, id] of Object.entries(this.positions)) if (id === player.id) delete this.positions[pos];
        this.players.splice(playerIdx, 1);
        candidate = player;
      }
    }
    if (!candidate) return null;
    candidate.isAdmin = true;
    this.admin = candidate;
    this.adminId = candidate.id;
    this.lastActivity = Date.now();
    return candidate;
  }

  getPlayer(playerId) {
    if (this.admin && this.admin.id === playerId) return this.admin;
    return this.players.find(p => p.id === playerId);
  }

  getViewerName(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    if (this.admin && this.admin.name.toLowerCase() === n) return true;
    if (this.players.some(p => p.name.toLowerCase() === n)) return true;
    if (this.spectators.some(s => s.name.toLowerCase() === n)) return true;
    // A name held by a vacated seat is still in use — block reuse so the admin
    // panel never shows two players with the same name.
    for (const v of Object.values(this.vacatedHands)) {
      if (v.playerName && v.playerName.toLowerCase() === n) return true;
    }
    return false;
  }

  countViewers() {
    // Bots are headless computer players, not human viewers, so they never count
    // against the 25-viewer cap. A host who sits as a player is in this.players,
    // so avoid double-counting the admin.
    const humans = this.players.filter(p => !p.isBot).length +
      this.spectators.filter(s => !s.isBot).length;
    if (this.admin && !this.players.includes(this.admin)) return humans + 1;
    return humans;
  }

  addSpectator(name) {
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) return null;
    if (this.getViewerName(clean)) return null;
    if (this.countViewers() >= 25) return null;
    const s = new Player(uuidv4(), clean);
    this.spectators.push(s);
    this.lastActivity = Date.now();
    return s;
  }

  removeSpectator(playerId) {
    const idx = this.spectators.findIndex(s => s.id === playerId);
    if (idx === -1) return false;
    this.spectators.splice(idx, 1);
    this.lastActivity = Date.now();
    return true;
  }

  countBots() {
    return this.players.filter(p => p.isBot).length + this.spectators.filter(s => s.isBot).length;
  }

  addBot() {
    if (this.countBots() >= MAX_BOTS) return null;
    // Pick any unused pool name at random — never the same as a live/waiting name.
    const pool = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const name = pool.find(n => !this.getViewerName(n));
    if (!name) return null;
    const bot = new Player(uuidv4(), name);
    bot.isBot = true;
    this.spectators.push(bot);
    this.lastActivity = Date.now();
    return bot;
  }

  // Removes a bot anywhere (unseated spectator or seated player). Seated bots are
  // vacated first so their seat's saved hand is preserved for the next human.
  removeBot(botId) {
    const target = this.getPlayer(botId) || this.spectators.find(s => s.id === botId);
    if (!target || !target.isBot) return null;
    this.removePlayer(botId);
    return target;
  }

  // Un-seat a seated bot, saving its hand mid-game and returning it to the spectator
  // list. A bot never blocks a human seat, but a human is never displaced this way.
  _unseatBot(bot) {
    const pos = bot.position;
    if (this.state !== 'waiting' && this.state !== 'cut' && pos) this.vacateSeat(bot);
    for (const [p, id] of Object.entries(this.positions)) if (id === bot.id) delete this.positions[p];
    bot.position = null; bot.team = null; bot.hand = []; bot.bid = null;
    bot.playedCard = null; bot.cutCard = null;
    if (!this.spectators.includes(bot)) this.spectators.push(bot);
    this.lastActivity = Date.now();
  }

  getViewer(playerId) {
    return this.getPlayer(playerId) || this.spectators.find(s => s.id === playerId);
  }

  revokeToken(playerId) {
    if (playerId) this.revokedTokens.add(playerId);
  }

  isTokenRevoked(playerId) {
    return !!playerId && this.revokedTokens.has(playerId);
  }

  // Reconnect window closed for an offline player: vacate their seat and invalidate their token.
  vacateTimedOutPlayer(playerId) {
    if (!this.getPlayer(playerId)) return false;
    this.revokedTokens.add(playerId);
    return this.removePlayer(playerId);
  }

  restoreSavedState(player, pos) {
    const saved = this.vacatedHands[pos];
    if (!saved) return;
    player.hand = saved.hand;
    player.bid = saved.bid || null;
    player.playedCard = saved.playedCard || null;
    if (saved.wasCurrentPlayer) this.currentPlayer = player;
    if (saved.wasDeclarer) this.declarer = player;
    if (saved.wasDummy) this.dummy = player;
    // The seat may already be referenced as the current/declaring seat even when the
    // saved flags are false (e.g. the admin won the auction while acting for the
    // seat, or the turn advanced onto the vacated seat via seatAfter): re-point them.
    if (!saved.wasCurrentPlayer && this.currentPlayer && this.currentPlayer.id === null && this.currentPlayer.position === pos) {
      this.currentPlayer = player;
    }
    if (!saved.wasDeclarer && this.declarer && this.declarer.id === null && this.declarer.position === pos) {
      this.declarer = player;
    }
    if (this.dealer && this.dealer.id === null && this.dealer.position === pos) this.dealer = player;
    // The declarer seat is back: if the reserved card never rejoined (it couldn't be
    // delivered while the seat was in limbo), join it into the refilled hand now.
    if (saved.wasDeclarer && this.trumpCard && !this.trumpCardPlayed && this.trumpRevealed) {
      player.hand.push(this.trumpCard);
      this.trumpCard = null;
    }
    delete this.vacatedHands[pos];
  }

  promoteSpectator(adminId, spectatorId, position) {
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin) return null;
    if (this.players.length >= 4) {
      // A full table only opens for a human replacing a seated bot (net count unchanged).
      const occupant = this.positions[position] ? this.getPlayer(this.positions[position]) : null;
      if (!position || !occupant || !occupant.isBot) return null;
    }
    const idx = this.spectators.findIndex(s => s.id === spectatorId);
    if (idx === -1) return null;
    const [s] = this.spectators.splice(idx, 1);
    if (position && ['N','S','E','W'].includes(position) && !this.positions[position]) {
      s.position = position;
      s.team = (position === 'N' || position === 'S') ? 'N-S' : 'E-W';
      this.positions[position] = s.id;
    } else {
      // Seat taken by a bot: displace the bot (saving its hand mid-game) and seat
      // the incoming human — the admin's panel promotes into free or bot-held seats.
      if (position && this.positions[position]) {
        const occupant = this.getPlayer(this.positions[position]);
        if (occupant && occupant.isBot) this._unseatBot(occupant);
        if (['N','S','E','W'].includes(position) && !this.positions[position]) {
          s.position = position;
          s.team = (position === 'N' || position === 'S') ? 'N-S' : 'E-W';
          this.positions[position] = s.id;
        } else {
          s.position = null;
          s.team = null;
        }
      } else {
        s.position = null;
        s.team = null;
      }
    }
    this.players.push(s);
    this._maybeDealCutCard(s);
    if (this.state !== 'waiting' && this.state !== 'cut') this.restoreSavedState(s, s.position);
    this.lastActivity = Date.now();
    return s;
  }

  setPosition(playerId, pos) {
    if (!['N', 'S', 'E', 'W'].includes(pos)) return false;
    const player = this.getPlayer(playerId);
    if (!player) return false;
    if (this.positions[pos]) {
      const occupant = this.getPlayer(this.positions[pos]);
      if (occupant && occupant.isBot && occupant.id !== playerId) this._unseatBot(occupant);
    }
    for (const [p, id] of Object.entries(this.positions)) {
      if (id === playerId) delete this.positions[p];
    }
    this.positions[pos] = playerId;
    player.position = pos;
    player.team = (pos === 'N' || pos === 'S') ? 'N-S' : 'E-W';
    this._maybeDealCutCard(player);
    if (this.state !== 'waiting' && this.state !== 'cut') this.restoreSavedState(player, pos);
    this.lastActivity = Date.now();
    return true;
  }

  // The host may sit as a player on the table (dual role). A bot holding the seat
  // is displaced; a human holding it cannot be displaced this way.
  adminSit(position) {
    const admin = this.admin;
    if (!admin || admin.position) return null;
    if (!['N', 'S', 'E', 'W'].includes(position)) return null;
    const occupant = this.positions[position] ? this.getPlayer(this.positions[position]) : null;
    if (this.players.length >= 4) {
      // A full table only opens for the host replacing a seated bot.
      if (!occupant || !occupant.isBot) return null;
    }
    if (this.positions[position]) {
      if (occupant && occupant.isBot) this._unseatBot(occupant);
      else if (occupant && occupant.id !== admin.id) return null;
    }
    if (!this.players.includes(admin)) this.players.push(admin);
    this.positions[position] = admin.id;
    admin.position = position;
    admin.team = (position === 'N' || position === 'S') ? 'N-S' : 'E-W';
    this._maybeDealCutCard(admin);
    if (this.state !== 'waiting' && this.state !== 'cut') this.restoreSavedState(admin, position);
    this.lastActivity = Date.now();
    return admin;
  }

  // The host steps off the table back to spectator-style hosting. Mid-game the seat
  // is vacated (hand saved) so it can be filled or re-sat by the admin.
  adminLeaveSeat() {
    const admin = this.admin;
    if (!admin || !admin.position) return null;
    const pos = admin.position;
    if (this.state !== 'waiting' && this.state !== 'cut') this.vacateSeat(admin);
    for (const [p, id] of Object.entries(this.positions)) if (id === admin.id) delete this.positions[p];
    admin.position = null; admin.team = null; admin.hand = []; admin.bid = null;
    admin.playedCard = null; admin.cutCard = null;
    const idx = this.players.indexOf(admin);
    if (idx !== -1) this.players.splice(idx, 1);
    this.lastActivity = Date.now();
    return admin;
  }

  seatedPlayers() {
    const order = ['N', 'S', 'E', 'W'];
    const out = [];
    for (const pos of order) {
      const pid = this.positions[pos];
      if (pid) {
        const p = this.getPlayer(pid);
        if (p) out.push(p);
      }
    }
    return out;
  }

  startCut() {
    if (this.state !== 'waiting') return false;
    const seated = this.seatedPlayers();
    if (seated.length < 4) return false;
    this.setupDeck();
    for (const player of seated) {
      player.cutCard = this.deck.pop();
    }
    this.state = 'cut';
    this.lastActivity = Date.now();
    return true;
  }

  // During the cut phase every seated player must hold a cutCard. A seat filled after
  // startCut (promote/setPosition/adminSit) arrives without one — deal it immediately
  // so the cut list always shows a card and determineDealer can never read a null.
  _maybeDealCutCard(player) {
    if (this.state !== 'cut' || !player || player.cutCard || this.deck.length === 0) return;
    player.cutCard = this.deck.pop();
  }

  determineDealer() {
    const seated = this.seatedPlayers();
    // Guard: if any seat still lacks a cutCard (edge cases beyond the three seating
    // paths), deal one now so the cut always resolves instead of crashing the server.
    for (const p of seated) {
      if (!p.cutCard) {
        p.cutCard = this.deck.length > 0 ? this.deck.pop() : new Card('♠', 'Q');
      }
    }
    let highest = seated[0];
    for (const p of seated) {
      if (RANK_ORDER[p.cutCard.rank] > RANK_ORDER[highest.cutCard.rank]) {
        highest = p;
      }
    }
    this.dealer = highest;
    for (const p of seated) { p.cutCard = null; p.bid = null; }
    this.setupDeck();
    this.dealCards(4);
    this.currentPlayer = this.seatAfter(this.dealer.position);
    this.state = 'bidding';
    this.lastBidder = null;
    this.highestBid = null;
    this.passCount = 0;
    this.lastActivity = Date.now();
  }

  getNextPlayer(currentId) {
    const order = ['N', 'E', 'S', 'W'];
    const player = this.getPlayer(currentId);
    if (!player || !player.position) return null;
    const idx = order.indexOf(player.position);
    const nextPos = order[(idx + 1) % 4];
    const nextId = this.positions[nextPos];
    return this.getPlayer(nextId);
  }

  vacatedPseudo(pos) {
    const saved = this.vacatedHands[pos];
    if (!saved) return null;
    return {
      id: null,
      name: saved.playerName || pos,
      position: pos,
      team: saved.team
    };
  }

  seatAfter(pos) {
    const order = ['N', 'E', 'S', 'W'];
    const idx = order.indexOf(pos);
    if (idx === -1) return null;
    for (let i = 1; i <= 4; i++) {
      const p = order[(idx + i) % 4];
      const pid = this.positions[p];
      if (pid) {
        const pl = this.getPlayer(pid);
        if (pl) return pl;
      } else if (this.vacatedHands[p]) {
        return this.vacatedPseudo(p);
      }
    }
    return null;
  }

  getPartnerPosition(pos) {
    return { N: 'S', S: 'N', E: 'W', W: 'E' }[pos];
  }

  dealCards(count) {
    const seated = this.seatedPlayers();
    for (let i = 0; i < count && this.deck.length > 0; i++) {
      for (const p of seated) {
        if (this.deck.length > 0) p.hand.push(this.deck.pop());
      }
      for (const pos of Object.keys(this.vacatedHands)) {
        if (this.deck.length > 0) this.vacatedHands[pos].hand.push(this.deck.pop());
      }
    }
  }

  _placeBid(seat, position, bid) {
    if (this.state !== 'bidding') return false;
    if (bid === 'pass') {
      seat.bid = 'pass';
      this.passCount++;
    } else if (typeof bid === 'number' && bid >= 50 && bid <= 200 && bid % 10 === 0 && bid > (this.highestBid || 0)) {
      seat.bid = bid;
      this.lastBidder = seat;
      this.highestBid = bid;
      this.passCount = 0;
    } else {
      return false;
    }
    if (this.passCount >= 4 && !this.lastBidder) {
      this.resetForNextHand(false);
      return true;
    }
    if (this.passCount >= 3 && this.lastBidder) {
      this.declarer = this.lastBidder;
      this.dummy = this.getPlayer(this.positions[this.getPartnerPosition(this.declarer.position)]);
      this.state = 'trump_selection';
      this.currentPlayer = this.declarer;
      this.lastActivity = Date.now();
      return true;
    }
    this.currentPlayer = this.seatAfter(position);
    this.lastActivity = Date.now();
    return true;
  }

  placeBid(playerId, bid) {
    const player = this.getPlayer(playerId);
    if (!player || player !== this.currentPlayer) return false;
    const r = this._placeBid(player, player.position, bid);
    if (r && this._timedOutPlayerId === playerId) this._timedOutPlayerId = null;
    return r;
  }

  placeVacatedBid(position, bid) {
    const saved = this.vacatedHands[position];
    if (!saved || this.currentPlayer?.position !== position) return false;
    return this._placeBid(saved, position, bid);
  }

  _selectTrump(hand, card) {
    if (this.state !== 'trump_selection') return false;
    if (!card || !card.suit || !card.rank) return false;
    const idx = hand.findIndex(c => c.rank === card.rank && c.suit === card.suit);
    if (idx === -1) return false;
    this.trumpSuit = card.suit;
    this.trumpCard = hand.splice(idx, 1)[0];
    this.trumpCardIndex = idx;
    this.dealCards(2);
    // Before the first trick, check whether the declarer's team holds every card of
    // the trump suit. If so, pause and ask the admin to redeal instead of playing a
    // lopsided hand (defenders would hold no trump at all).
    if (this.trumpSuit && this.teamHoldsAllTrump()) {
      this.redealPending = {
        reason: "Declarer's team holds all 6 trump suit cards",
        redealCount: this.redealCount,
        declarerTeam: this.declarer ? (['N', 'S'].includes(this.declarer.position) ? 'N-S' : 'E-W') : null
      };
      this.state = 'redeal_pending';
      this.currentPlayer = null;
      return true;
    }
    this.state = 'playing';
    this.currentTrick = [];
    this.trickNumber = 0;
    this.currentPlayer = this.seatAfter(this.dealer.position);
    this.lastActivity = Date.now();
    return true;
  }

  // True when the declarer's team (declarer + dummy, including any vacated seats and
  // the reserved trump card) collectively holds all 6 cards of the trump suit.
  teamHoldsAllTrump() {
    if (!this.declarer || !this.trumpSuit) return false;
    const trump = this.trumpSuit;
    const teamSeats = ['N', 'S'].includes(this.declarer.position) ? ['N', 'S'] : ['E', 'W'];
    const d = this.getPlayer(this.declarer.id);
    const pid = this.positions[this.getPartnerPosition(this.declarer.position)];
    const partner = pid ? this.getPlayer(pid) : null;
    const held = [];
    if (d) held.push(...(d.hand || []));
    if (partner) held.push(...(partner.hand || []));
    if (this.trumpCard) held.push(this.trumpCard);
    for (const pos of teamSeats) {
      const v = this.vacatedHands[pos];
      if (v) held.push(...(v.hand || []));
    }
    const count = held.filter(c => c.suit === trump).length;
    return count >= 6;
  }

  selectTrump(playerId, card) {
    if (playerId !== this.declarer?.id) return false;
    const player = this.getPlayer(playerId);
    if (!player) return false;
    const r = this._selectTrump(player.hand, card);
    if (r && this._timedOutPlayerId === playerId) this._timedOutPlayerId = null;
    return r;
  }

  selectVacatedTrump(position, card) {
    if (this.declarer?.position !== position) return false;
    const saved = this.vacatedHands[position];
    if (!saved) return false;
    return this._selectTrump(saved.hand, card);
  }

  _playCard(hand, position, card, playedBy) {
    if (this.state !== 'playing') return false;
    const idx = hand.findIndex(c => c.equals(card));
    if (idx === -1) return false;
    const played = hand.splice(idx, 1)[0];
    if (this.currentTrick.length === 0) {
      this.leadSuit = played.suit;
    } else if (played.suit !== this.leadSuit) {
      if (hand.some(c => c.suit === this.leadSuit)) { hand.splice(idx, 0, played); return false; }
    }
    this.currentTrick.push({ player: playedBy, card: played });
    if (playedBy.id) playedBy.playedCard = played;
    if (this.currentTrick.length === 4) {
      this.endTrick();
    } else {
      this.currentPlayer = this.seatAfter(position);
    }
    this.lastActivity = Date.now();
    return true;
  }

  playCard(playerId, card) {
    const player = this.getPlayer(playerId);
    if (!player || player !== this.currentPlayer) return false;
    const r = this._playCard(player.hand, player.position, card, player);
    if (r && this._timedOutPlayerId === playerId) this._timedOutPlayerId = null;
    return r;
  }

  playVacatedCard(position, card) {
    const saved = this.vacatedHands[position];
    if (!saved || this.currentPlayer?.position !== position) return false;
    return this._playCard(saved.hand, position, card, this.vacatedPseudo(position));
  }

  // Shared trump-card play core. `hand` is where the led-suit check reads from
  // (live player or vacated seat), `player` is what gets pushed to the trick
  // (a live Player sets .playedCard; a vacated pseudo has id null and is skipped).
  _playTrumpCore(hand, player, position) {
    if (this.state !== 'playing') return false;
    if (!this.trumpCard || this.trumpCardPlayed) return false;
    const isLastTrick = this.trickNumber >= 5;
    // An empty declarer hand means the reserved card is the only card left — always
    // playable (this also covers the last trick, but is allowed on any trick so the
    // play can never freeze when the hand counter has drifted by one).
    const onlyCardLeft = hand.length === 0;
    if (!isLastTrick && !onlyCardLeft) {
      if (this.currentTrick.length === 0) return false;
      if (this.leadSuit) {
        const hasSuit = hand.some(c => c.suit === this.leadSuit);
        if (hasSuit) return false;
      }
    }
    const played = this.trumpCard;
    this.trumpCard = null;
    this.trumpRevealed = true;
    this.trumpCardPlayed = true;
    if (player.id) player.playedCard = played;
    if (this.currentTrick.length === 0) this.leadSuit = played.suit;
    this.currentTrick.push({ player, card: played });
    if (this.currentTrick.length === 4) {
      this.endTrick();
    } else {
      this.currentPlayer = this.seatAfter(position);
    }
    this.lastActivity = Date.now();
    return true;
  }

  playVacatedTrump(position) {
    const saved = this.vacatedHands[position];
    if (!saved || this.currentPlayer?.position !== position) return false;
    if (this.declarer?.position !== position) return false;
    return this._playTrumpCore(saved.hand, this.vacatedPseudo(position), position);
  }

  endTrick() {
    let winner = this.currentTrick[0];
    let winningCard = winner.card;
    const trumpActive = this.trumpRevealed && !!this.trumpSuit;
    for (const entry of this.currentTrick) {
      const card = entry.card;
      if (trumpActive && card.suit === this.trumpSuit && winningCard.suit !== this.trumpSuit) {
        winner = entry; winningCard = card;
      } else if (card.suit === winningCard.suit && RANK_ORDER[card.rank] > RANK_ORDER[winningCard.rank]) {
        winner = entry; winningCard = card;
      }
    }
    this.teamTricks[winner.player.team]++;
    const trickPoints = {};
    for (const entry of this.currentTrick) {
      this.teamPoints[winner.player.team] += entry.card.hcp;
      trickPoints[entry.player.team] = (trickPoints[entry.player.team] || 0) + entry.card.hcp;
    }
    this.trickHistory.push({
      trickNumber: this.trickNumber,
      cards: this.currentTrick.map(e => ({
        playerId: e.player.id,
        playerName: e.player.name,
        position: e.player.position,
        card: { suit: e.card.suit, rank: e.card.rank, hcp: e.card.hcp }
      })),
      winnerTeam: winner.player.team,
      winnerPosition: winner.player.position,
      teamPoints: trickPoints,
      winnerPoints: (trickPoints['N-S'] || 0) + (trickPoints['E-W'] || 0)
    });
    this.currentTrick = [];
    // The trick winner leads the next one. If their seat was refilled or vacated
    // mid-trick (seat churn), hand the lead to whoever now holds that seat.
    const ws = winner.position;
    const winnerSeated = winner.player && this.positions[ws] === winner.player.id;
    this.currentPlayer = winnerSeated ? winner.player
      : (this.getPlayer(this.positions[ws]) || this.vacatedPseudo(ws) || winner.player);
    this.trickNumber++;
    if (this.trickNumber >= 6) {
      this.handNumber++;
      this.state = 'hand_review';
      this.currentPlayer = null;
    }
    this.lastActivity = Date.now();
  }

  askTrump(playerId) {
    if (this.state !== 'playing') return false;
    const player = this.getPlayer(playerId);
    if (!player || !this.declarer || player.id === this.declarer.id) return false;
    if (this.trumpRevealed) return false;
    if (this.currentTrick.length === 0) return false;
    this.trumpRevealed = true;
    this.rejoinTrumpCard();
    this.lastActivity = Date.now();
    return true;
  }

  rejoinTrumpCard() {
    if (!this.trumpCard || this.trumpCardPlayed) return;
    const dPos = this.declarer?.position;
    if (!dPos) return;
    const live = this.players.find(p => p.position === dPos);
    let rejoined = false;
    if (live) {
      live.hand.push(this.trumpCard);
      rejoined = true;
    } else if (this.vacatedHands[dPos]) {
      this.vacatedHands[dPos].hand.push(this.trumpCard);
      rejoined = true;
    }
    // If the declarer's seat is in limbo (neither a live player nor a saved seat —
    // e.g. mid disconnect/reconnect), keep the card reserved instead of dropping it:
    // it is picked up again when the seat is refilled (restoreSavedState) or played
    // via Play Trump. Never let the reserved card vanish from the game.
    if (rejoined) this.trumpCard = null;
  }

  playTrumpCard(playerId) {
    if (this.state !== 'playing') return false;
    if (playerId !== this.declarer?.id) return false;
    if (!this.currentPlayer || this.currentPlayer.id !== playerId) return false;
    const player = this.getPlayer(playerId);
    if (!player) return false;
    const r = this._playTrumpCore(player.hand, player, player.position);
    if (r && this._timedOutPlayerId === playerId) this._timedOutPlayerId = null;
    return r;
  }

  confirmHand(adminId) {
    if (this.state !== 'hand_review') return false;
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin) return false;
    const declarerTeam = this.declarer.team;
    const declarerTricks = this.teamTricks[declarerTeam];
    const defendingTeam = declarerTeam === 'N-S' ? 'E-W' : 'N-S';
    const declarerHCP = this.teamPoints[declarerTeam];
    const bid = this.declarer.bid;
    // Points granted are 2 when the bid is 100 or more, else 1
    const basePts = bid >= 100 ? 2 : 1;
    // Winning team also earns +2 for a slam (collecting all 300 HCP)
    let winnerTeam, pts;
    if (declarerHCP >= bidRequirement(bid)) {
      winnerTeam = declarerTeam;
      pts = basePts;
    } else {
      // Defenders get double the points of the bid when the declarer team loses
      winnerTeam = defendingTeam;
      pts = basePts * 2;
    }
    this.scores[winnerTeam] += pts;
    if (this.teamPoints[winnerTeam] >= 300) {
      this.scores[winnerTeam] += 2;
    }
    for (const p of this.players) p.score = this.scores[p.team] || 0;
    if (this.scores['N-S'] >= WINNING_SCORE || this.scores['E-W'] >= WINNING_SCORE) {
      this.state = 'game_over';
      this.winner = this.scores['N-S'] >= this.scores['E-W'] ? 'N-S' : 'E-W';
    } else {
      this.resetForNextHand(true);
    }
    this.lastActivity = Date.now();
    return true;
  }

  redealAdmin() {
    if (!this.redealPending) return false;
    this.redealPending = null;
    this.redealCount++;
    // Up to 3 same-dealer redeals are allowed; on the 4th occurrence rotate the
    // dealer to the next player and reset the counter so the game can't stall.
    if (this.redealCount > 3) {
      this.redealCount = 0;
      this.resetForNextHand(true);
    } else {
      this.resetForNextHand(false);
    }
    return true;
  }

  resetForNextHand(rotateDealer = false) {
    for (const p of this.players) {
      p.hand = []; p.bid = null; p.playedCard = null;
      p.cutCard = null;
    }
    for (const pos of Object.keys(this.vacatedHands)) {
      const v = this.vacatedHands[pos];
      v.hand = []; v.bid = null; v.playedCard = null;
      v.wasCurrentPlayer = false; v.wasDeclarer = false; v.wasDummy = false;
    }
    this.teamTricks = { 'N-S': 0, 'E-W': 0 };
    this.teamPoints = { 'N-S': 0, 'E-W': 0 };
    this.trumpSuit = null; this.trumpCard = null; this.trumpCardIndex = -1;
    this.trumpRevealed = false; this.trumpCardPlayed = false; this.currentTrick = []; this.trickHistory = []; this.trickNumber = 0;
    this.declarer = null; this.dummy = null; this.lastBidder = null;
    this.highestBid = null; this.passCount = 0;
    this.currentPlayer = null; this.leadSuit = null;
    this._timedOutPlayerId = null;
    this.redealPending = null;
    if (rotateDealer && this.dealer) this.dealer = this.seatAfter(this.dealer.position);
    this.setupDeck();
    this.dealCards(4);
    this.currentPlayer = this.dealer ? this.seatAfter(this.dealer.position) : null;
    this.state = 'bidding';
  }

  kickPlayer(adminId, targetId) {
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin || adminId === targetId) return false;
    return this.removePlayer(targetId);
  }

  demoteToSpectator(adminId, targetId) {
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin || adminId === targetId) return null;
    const p = this.getPlayer(targetId);
    if (!p) return null;
    const pos = p.position;
    this.removePlayer(targetId);
    p.position = null;
    p.hand = [];
    p.bid = null;
    p.playedCard = null;
    p.cutCard = null;
    p.team = null;
    p.isAdmin = false;
    this.spectators.push(p);
    this.lastActivity = Date.now();
    return p;
  }

  rotateDealer(adminId) {
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin || !this.dealer) return false;
    this.dealer = this.seatAfter(this.dealer.position);
    this.lastActivity = Date.now();
    return true;
  }

  resetScores(adminId) {
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin) return false;
    this.scores = { 'N-S': 0, 'E-W': 0 };
    this.teamTricks = { 'N-S': 0, 'E-W': 0 };
    this.teamPoints = { 'N-S': 0, 'E-W': 0 };
    for (const p of this.players) p.score = 0;
    this.lastActivity = Date.now();
    return true;
  }

  sortHand(hand) {
    return hand.slice().sort((a, b) => {
      const si = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
      return si !== 0 ? si : RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
    });
  }

  checkMemo(key, hand) {
    const sig = hand.map(c => c.suit + c.rank).join(',');
    if (this._memo && this._memo[key] && this._memo[key].sig === sig) {
      return this._memo[key].sorted;
    }
    if (!this._memo) this._memo = {};
    const sorted = this.sortHand(hand);
    this._memo[key] = { sig, sorted };
    return sorted;
  }

  getGameState(playerId) {
    const viewer = this.getViewer(playerId);
    const isSpectator = viewer && !this.getPlayer(playerId);
    // Spectators (observers) see no player's hand — only the cards played on the
    // table during a trick (state.currentTrick) and each player's card count.
    const adminActsDeclarer = viewer?.isAdmin && this.declarer &&
      (!!this.vacatedHands[this.declarer.position] || this._timedOutPlayerId === this.declarer.id);
    const state = {
      roomId: this.id, state: this.state,
      dealer: this.dealer ? { id: this.dealer.id, name: this.dealer.name, position: this.dealer.position } : null,
      currentPlayer: this.currentPlayer ? { id: this.currentPlayer.id, name: this.currentPlayer.name, position: this.currentPlayer.position } : null,
      trumpSuit: (this.trumpRevealed || this.state === 'game_over' || viewer?.id === this.declarer?.id || adminActsDeclarer) ? this.trumpSuit : null, trumpRevealed: this.trumpRevealed,
      trumpCard: (this.trumpRevealed || viewer?.id === this.declarer?.id || adminActsDeclarer) && this.trumpCard && !this.trumpCardPlayed ? { suit: this.trumpCard.suit, rank: this.trumpCard.rank } : null,
      trickNumber: this.trickNumber, handNumber: this.handNumber,
      highestBid: this.highestBid,
      declarer: this.declarer ? { id: this.declarer.id, position: this.declarer.position } : null,
      scores: { ...this.scores }, winner: this.winner,
      positions: { ...this.positions },
      currentTrick: this.currentTrick.map(e => ({
        playerId: e.player.id, playerName: e.player.name,
        position: e.player.position,
        card: { suit: e.card.suit, rank: e.card.rank }
      })),
      trickHistory: this.trickHistory,
      spectators: this.spectators.map(s => ({ id: s.id, name: s.name, isBot: s.isBot })),
      redealCount: this.redealCount,
      redealPending: this.redealPending ? { ...this.redealPending } : null
    };
    state.teamTricks = { ...this.teamTricks };
    state.teamPoints = { ...this.teamPoints };
    state.admin = this.admin ? { id: this.admin.id, name: this.admin.name } : null;
    if (this.state === 'cut') {
      state.cutCards = this.players.map(p => ({
        name: p.name,
        position: p.position,
        card: p.cutCard ? { suit: p.cutCard.suit, rank: p.cutCard.rank } : null
      }));
    }
if (viewer) {
        state.me = {
          id: viewer.id, name: viewer.name, position: viewer.position,
          hand: isSpectator ? [] : this.checkMemo('me:' + viewer.id, viewer.hand).map(c => ({ suit: c.suit, rank: c.rank })),
          isAdmin: viewer.isAdmin, isSpectator: !!isSpectator, isBot: viewer.isBot, team: viewer.team,
          bid: viewer.bid, score: viewer.score,
          cutCard: viewer.cutCard ? { suit: viewer.cutCard.suit, rank: viewer.cutCard.rank } : null
        };
        const showHand = (p) => p.id === viewer.id;
        const reservedTrumpCount = (p) => (p.id === this.declarer?.id && this.trumpCard && !this.trumpCardPlayed ? 1 : 0);
        state.players = this.players.map(p => {
          const hand = showHand(p) ? this.checkMemo('p:' + p.id, p.hand).map(c => ({ suit: c.suit, rank: c.rank })) : undefined;
          return { id: p.id, name: p.name, position: p.position, team: p.team,
            isAdmin: p.isAdmin, isBot: p.isBot, bid: p.bid, score: p.score,
            online: p.online !== false,
            hand, cardCount: hand ? undefined : p.hand.length + reservedTrumpCount(p) };
        });
        for (const [pos, v] of Object.entries(this.vacatedHands)) {
          state.players.push({
            id: null, name: v.playerName || pos, position: pos, team: v.team,
            isAdmin: false, bid: v.bid, score: 0, vacated: true,
            cardCount: v.hand.length + (pos === this.declarer?.position && this.trumpCard && !this.trumpCardPlayed ? 1 : 0)
          });
        }
      if (viewer.isAdmin) {
        state.vacatedHands = Object.entries(this.vacatedHands).map(([pos, v]) => ({
          position: pos,
          playerName: v.playerName || pos,
          team: v.team,
          wasCurrentPlayer: !!v.wasCurrentPlayer,
          hand: this.checkMemo('v:' + pos + ':a', v.hand).map(c => ({ suit: c.suit, rank: c.rank }))
        }));
        const tpid = this._timedOutPlayerId;
        const tp = tpid && this.currentPlayer && this.currentPlayer.id === tpid && this.getPlayer(tpid);
        if (tp && tp.position) {
          state.timedOutHand = {
            playerId: tp.id, playerName: tp.name, position: tp.position, team: tp.team,
            hand: this.checkMemo('t:' + tp.id, tp.hand).map(c => ({ suit: c.suit, rank: c.rank }))
          };
        }
      }
    }
    return state;
  }

  toJSON() {
    return {
      id: this.id, roomId: this.roomId, state: this.state,
      players: this.players.map(p => ({
        id: p.id, name: p.name, position: p.position, team: p.team,
        isAdmin: false, isBot: p.isBot, bid: p.bid, score: p.score, online: p.online
      })),
      spectators: this.spectators.map(s => ({ id: s.id, name: s.name, isBot: s.isBot, online: s.online })),
      admin: this.admin ? { id: this.admin.id, name: this.admin.name, position: this.admin.position, team: this.admin.team, isBot: this.admin.isBot, online: this.admin.online } : null,
      dealer: this.dealer ? this.dealer.id : null,
      scores: this.scores, winner: this.winner,
      teamTricks: this.teamTricks, teamPoints: this.teamPoints,
      adminId: this.adminId, positions: this.positions,
      handNumber: this.handNumber, lastActivity: this.lastActivity,
      revokedTokens: [...this.revokedTokens],
      redealCount: this.redealCount
    };
  }

  static fromJSON(data) {
    const g = new Game(data.id);
    g.roomId = data.roomId; g.state = data.state;
    g.scores = data.scores; g.winner = data.winner;
    g.teamTricks = data.teamTricks || { 'N-S': 0, 'E-W': 0 };
    g.teamPoints = data.teamPoints || { 'N-S': 0, 'E-W': 0 };
    g.adminId = data.adminId; g.positions = data.positions;
    g.handNumber = data.handNumber || 0; g.lastActivity = data.lastActivity || Date.now();
    g.revokedTokens = new Set(data.revokedTokens || []);
    g.redealCount = data.redealCount || 0;
    const pMap = {};
    for (const pd of data.players) {
      const p = new Player(pd.id, pd.name);
      p.position = pd.position; p.team = pd.team;
      p.isAdmin = false; p.isBot = !!pd.isBot; p.bid = pd.bid;
      p.score = pd.score || 0;
      p.online = pd.online !== false;
      g.players.push(p);
      pMap[pd.id] = p;
    }
    if (data.spectators) {
      for (const sd of data.spectators) {
        const s = new Player(sd.id, sd.name);
        s.isBot = !!sd.isBot;
        s.online = sd.online !== false;
        g.spectators.push(s);
      }
    }
    if (data.dealer) g.dealer = pMap[data.dealer] || null;
    if (data.admin) {
      const a = new Player(data.admin.id, data.admin.name);
      a.isAdmin = true;
      a.isBot = !!data.admin.isBot;
      a.position = data.admin.position || null;
      a.team = data.admin.team || null;
      g.admin = a;
      // A seated host is part of the player pool at runtime — mirror that on restore.
      if (a.position) g.players.push(a);
    }
    return g;
  }

  reset(keepAdmin = true) {
    const savedAdmin = keepAdmin ? this.admin : null;
    this.players = []; this.state = 'waiting'; this.dealer = null;
    this.currentPlayer = null; this.declarer = null; this.dummy = null;
    this.trumpSuit = null; this.trumpCard = null; this.trumpCardIndex = -1;
    this.trumpRevealed = false; this.currentTrick = []; this.trickHistory = []; this.trickNumber = 0;
    this.handNumber = 0; this.deck = []; this.lastBidder = null;
    this.highestBid = null; this.passCount = 0;
    this.scores = { 'N-S': 0, 'E-W': 0 }; this.winner = null;
    this.teamTricks = { 'N-S': 0, 'E-W': 0 };
    this.teamPoints = { 'N-S': 0, 'E-W': 0 };
    this.spectators = [];
    this.admin = savedAdmin;
    this.adminId = savedAdmin ? savedAdmin.id : null;
    this.positions = {}; this.leadSuit = null;
    this._timedOutPlayerId = null;
    this.vacatedHands = {};
    this.redealCount = 0;
    this.redealPending = null;
  }
}

module.exports = { Game, Player, Card, SUITS, RANKS, RANK_ORDER, HCP_VALUES, WINNING_SCORE, bidRequirement, BOT_NAMES, MAX_BOTS };
