"use strict";
const { v4: uuidv4 } = require('uuid');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['J', '9', 'A', '10', 'K', 'Q'];
const RANK_ORDER = { J: 6, 9: 5, A: 4, 10: 3, K: 2, Q: 1 };
const HCP_VALUES = { J: 30, 9: 18, A: 12, 10: 10, K: 3, Q: 2 };
const WINNING_SCORE = 12;
// Cards each seat is dealt for a hand (24-card deck / 4 seats). The declarer holds
// HAND_SIZE - 1 in hand plus the reserved trump card set aside at trump selection.
const HAND_SIZE = 6;
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
    // Diagnostics for the previous hand. Overwritten at the start of every hand so it
    // always holds the most recent one - see startHandLog()/reconcileHands().
    this.lastHandLog = null;
    this._lastIntegritySignature = null;
    this._handDealtComplete = false;
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

  // Auto-arrange the waiting table ("Assign Seats" button): seat unseated humans
  // first at random open positions, then fill remaining open positions with
  // existing unseated bots. Only when there are no unseated humans does the host
  // admin take a seat (so the table still has a human). Never adds new bots and
  // never displaces a seated player. Returns the seating summary or null.
  assignSeats(adminId) {
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin) return null;
    if (this.state !== 'waiting') return null;
    const open = ['N', 'S', 'E', 'W'].filter((pos) => !this.positions[pos]);
    if (open.length === 0) return null;
    // Fisher–Yates shuffle so seats are assigned randomly.
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [open[i], open[j]] = [open[j], open[i]];
    }
    const seated = [];
    let i = 0;
    const humans = this.players.filter((p) => !p.isBot && !p.position);
    if (humans.length > 0) {
      for (const h of humans) {
        if (i >= open.length) break;
        this.setPosition(h.id, open[i]);
        seated.push(`${h.name}@${open[i]}`);
        i++;
      }
    } else if (admin && !admin.position && i < open.length) {
      this.adminSit(open[i]);
      seated.push(`${admin.name}@${open[i]}`);
      i++;
    }
    const bots = this.spectators.filter((s) => s.isBot && !s.position);
    for (const b of bots) {
      if (i >= open.length) break;
      this.promoteSpectator(adminId, b.id, open[i]);
      seated.push(`${b.name}@${open[i]}`);
      i++;
    }
    this.lastActivity = Date.now();
    return seated;
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
    // The table needs at least one human (the host admin can sit as that human).
    if (seated.every((p) => p.isBot)) return false;
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
    if (this.state !== 'cut') return false;
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
    this.startHandLog();
    this.setupDeck();
    this.dealCards(4);
    this.currentPlayer = this.seatAfter(this.dealer.position);
    this.state = 'bidding';
    this.lastBidder = null;
    this.highestBid = null;
    this.passCount = 0;
    this.logEvent('bidding_start', { dealer: this.dealer.position, lead: (this.currentPlayer || {}).position });
    this.lastActivity = Date.now();
    return true;
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
    const before = seat.bid;
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
    this.logEvent('bid', { position, bid: seat.bid, previous: before, highest: this.highestBid });
    if (this.passCount >= 4 && !this.lastBidder) {
      this.resetForNextHand(false);
      return true;
    }
    if (this.passCount >= 3 && this.lastBidder) {
      this.declarer = this.lastBidder;
      this.dummy = this.getPlayer(this.positions[this.getPartnerPosition(this.declarer.position)]);
      this.state = 'trump_selection';
      this.currentPlayer = this.declarer;
      this.logEvent('contract', { declarer: this.declarer.position, bid: this.declarer.bid, dummy: this.dummy ? this.dummy.position : null });
      // The contract is only known now, so fill in what startHandLog() could not.
      if (this.lastHandLog) {
        this.lastHandLog.declarer = this.declarer.position;
        this.lastHandLog.bid = this.declarer.bid;
        if (this.lastHandLog.seats[this.declarer.position]) {
          this.lastHandLog.seats[this.declarer.position].bid = this.declarer.bid;
        }
      }
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
    // Positive signal that the hand really was dealt in full (16 cards during bidding plus
    // these last 8). reconcileHands() uses it to tell a lost card apart from a hand that
    // was never fully dealt - in both cases the same number of cards is unaccounted for.
    if (this.deck.length === 0) this._handDealtComplete = true;
    if (this.lastHandLog) {
      this.lastHandLog.trumpSuit = this.trumpSuit;
      this.lastHandLog.reservedTrump = this.trumpCard.toString();
      this.lastHandLog.bid = this.declarer ? this.declarer.bid : this.highestBid;
      for (const pos of ['N', 'S', 'E', 'W']) {
        const p = this.getPlayer(this.positions[pos]);
        const v = this.vacatedHands[pos];
        if (this.lastHandLog.seats[pos]) this.lastHandLog.seats[pos].handSize = p ? p.hand.length : (v ? (v.hand || []).length : 0);
      }
    }
    this.logEvent('trump_reserved', {
      position: (this.declarer && this.declarer.position) || null,
      trumpSuit: this.trumpSuit,
      reserved: this.trumpCard.toString(),
    });
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
      this.logEvent('redeal_pending', { reason: this.redealPending.reason });
      return true;
    }
    this.state = 'playing';
    this.currentTrick = [];
    this.trickNumber = 0;
    this.currentPlayer = this.seatAfter(this.dealer.position);
    this.logEvent('playing_start', { lead: (this.currentPlayer || {}).position });
    this.reconcileHands('trump-selected');
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
    // A seat may hold at most one card in a trick. Without this a take-over click that
    // lands after the player already played spends a second card for that seat, which
    // skips the seat after it and leaves the hand one card short of its 6 tricks.
    if (this.currentTrick.some(e => (e.player && e.player.position) === position)) return false;
    const played = hand.splice(idx, 1)[0];
    if (this.currentTrick.length === 0) {
      this.leadSuit = played.suit;
    } else if (played.suit !== this.leadSuit) {
      if (hand.some(c => c.suit === this.leadSuit)) { hand.splice(idx, 0, played); return false; }
    }
    this.currentTrick.push({ player: playedBy, card: played });
    if (playedBy.id) playedBy.playedCard = played;
    const willEnd = this.currentTrick.length === 4;
    const trickNo = this.trickNumber + 1;
    if (willEnd) {
      this.endTrick();
    } else {
      this.currentPlayer = this.seatAfter(position);
    }
    this.logPlay({ trick: trickNo, position, card: played.toString(), kind: 'card', handAfter: hand.length, next: (this.currentPlayer || {}).position || null, trickEnded: willEnd });
    if (willEnd) this.reconcileHands('trick-complete');
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
    // One card per seat per trick - see _playCard.
    if (this.currentTrick.some(e => (e.player && e.player.position) === position)) return false;
    const played = this.trumpCard;
    this.trumpCard = null;
    this.trumpRevealed = true;
    this.trumpCardPlayed = true;
    if (player.id) player.playedCard = played;
    if (this.currentTrick.length === 0) this.leadSuit = played.suit;
    this.currentTrick.push({ player, card: played });
    const willEnd = this.currentTrick.length === 4;
    const trickNo = this.trickNumber + 1;
    if (willEnd) {
      this.endTrick();
    } else {
      this.currentPlayer = this.seatAfter(position);
    }
    this.logPlay({ trick: trickNo, position, card: played.toString(), kind: 'reserved_trump', handAfter: hand.length, next: (this.currentPlayer || {}).position || null, trickEnded: willEnd });
    this.logEvent('trump_played', { position, card: played.toString() });
    if (willEnd) this.reconcileHands('trick-complete');
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

  // ---- Hand diagnostics ----------------------------------------------------
  // A frozen table used to be the only symptom of a lost card, which left the cause to
  // guesswork. Two things make it observable instead:
  //   startHandLog()   - a full trace of the current hand (every play of all 6 tricks,
  //                      the reserved-trump lifecycle, integrity repairs, the result).
  //                      Overwritten at the start of each hand, so it always holds the
  //                      most recent hand and nothing else.
  //   reconcileHands() - counts cards per seat (played in completed tricks + the trick in
  //                      progress + still in hand + the reserved trump) and hands any card
  //                      that belongs to nobody back to the short seat.
  startHandLog() {
    this._lastIntegritySignature = null;
    this._handDealtComplete = false;
    const seat = (pos) => {
      const p = this.getPlayer(this.positions[pos]);
      const v = this.vacatedHands[pos];
      return {
        position: pos,
        name: p ? p.name : (v ? v.name : null),
        id: p ? p.id : null,
        team: p ? p.team : (v ? v.team : null),
        isBot: p ? !!p.isBot : !!(v && v.isBot),
        handSize: p ? p.hand.length : (v ? (v.hand || []).length : 0),
      };
    };
    this.lastHandLog = {
      handNumber: this.handNumber + 1,
      startedAt: Date.now(),
      dealer: this.dealer ? this.dealer.position : null,
      declarer: this.declarer ? this.declarer.position : null,
      bid: this.highestBid,
      trumpSuit: this.trumpSuit,
      reservedTrump: null,
      trumpRevealed: false,
      seats: { N: seat('N'), S: seat('S'), E: seat('E'), W: seat('W') },
      plays: [],
      events: [],
      integrity: [],
      result: null,
    };
  }

  logEvent(type, data = {}) {
    if (!this.lastHandLog) return;
    this.lastHandLog.events.push({ at: Date.now(), type, ...data });
  }

  logPlay(entry) {
    if (!this.lastHandLog) return;
    this.lastHandLog.plays.push({ at: Date.now(), trick: this.trickNumber + 1, ...entry });
  }

  logIntegrity(report) {
    if (!this.lastHandLog) return;
    // Dedupe: a corrupt-but-unrepairable trick keeps reporting on every state read, so
    // only record (and print) a signature we have not seen yet for this hand.
    const signature = JSON.stringify([report.reason, report.missingCards, report.repairs, report.duplicateTrickCards, report.shortSeats]);
    if (this._lastIntegritySignature === signature) return;
    this._lastIntegritySignature = signature;
    this.lastHandLog.integrity.push({ at: Date.now(), ...report });
    console.log(`[hand ${this.lastHandLog.handNumber}] integrity: ${JSON.stringify(report)}`);
  }

  // Every completed trick must hold exactly 4 cards from 4 distinct seats, and by the
  // time trick N is scored each seat must have played exactly N cards. A seat appearing
  // twice in one trick (a take-over click landing after the player had already played)
  // skips a neighbour and shows up here as a per-seat total that does not add up.
  trickIntegrity() {
    const duplicates = [];
    for (let i = 0; i < this.trickHistory.length; i++) {
      const tally = {};
      for (const e of this.trickHistory[i].cards) {
        const pos = e.position || (e.player && e.player.position) || '?';
        tally[pos] = (tally[pos] || 0) + 1;
      }
      for (const pos of Object.keys(tally)) {
        if (tally[pos] > 1) duplicates.push({ trick: i + 1, position: pos, count: tally[pos] });
      }
    }
    const played = { N: 0, S: 0, E: 0, W: 0 };
    for (const t of this.trickHistory) {
      for (const e of t.cards) {
        const pos = e.position || (e.player && e.player.position);
        if (pos in played) played[pos]++;
      }
    }
    // Each seat must have played exactly one card per COMPLETED trick. The trick in
    // progress is excluded: seats that have not played it yet are perfectly normal, and
    // a second card from the same seat is already blocked at play time.
    const expected = this.trickHistory.length;
    const mismatched = Object.keys(played).filter(pos => played[pos] !== expected);
    return { duplicates, played, expected, mismatched, corrupt: duplicates.length > 0 || mismatched.length > 0 };
  }

  // Read-only card audit: for each seat, how many of its HAND_SIZE cards we can still
  // account for (played in completed tricks + the trick in progress + in hand, plus the
  // declarer's reserved trump), plus any card of the 24 that belongs to nobody. Purely
  // informational - it never changes a hand, so it is safe to call while building state.
  handAudit() {
    if (this.state !== 'playing' && this.state !== 'hand_review') return null;
    const seen = new Set();
    const account = (c) => { if (c && c.suit && c.rank) seen.add(c.suit + c.rank); };
    for (const t of this.trickHistory) for (const e of t.cards) account(e.card);
    for (const e of this.currentTrick) account(e.card);
    for (const p of this.players) for (const c of (p.hand || [])) account(c);
    for (const v of Object.values(this.vacatedHands)) for (const c of (v.hand || [])) account(c);
    if (this.trumpCard && !this.trumpCardPlayed) account(this.trumpCard);
    const orphans = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        if (!seen.has(suit + rank)) orphans.push(suit + rank);
      }
    }
    const counts = { N: 0, S: 0, E: 0, W: 0 };
    for (const t of this.trickHistory) {
      for (const e of t.cards) {
        const pos = e.position || (e.player && e.player.position);
        if (pos in counts) counts[pos]++;
      }
    }
    for (const e of this.currentTrick) {
      const pos = e.position || (e.player && e.player.position);
      if (pos in counts) counts[pos]++;
    }
    const dPos = this.declarer && this.declarer.position;
    const held = (pos) => {
      const live = this.players.find(p => p.position === pos);
      if (live) return live.hand;
      const v = this.vacatedHands[pos];
      return v && Array.isArray(v.hand) ? v.hand : null;
    };
    const seats = {};
    for (const pos of ['N', 'S', 'E', 'W']) {
      const hand = held(pos);
      if (!hand) continue;
      const reserved = (pos === dPos && this.trumpCard && !this.trumpCardPlayed) ? 1 : 0;
      const counted = counts[pos] + hand.length + reserved;
      seats[pos] = { played: counts[pos], inHand: hand.length, reserved, counted, expected: HAND_SIZE, short: HAND_SIZE - counted };
    }
    const integrity = this.trickIntegrity();
    return {
      seats,
      orphanCards: orphans,
      shortSeats: Object.keys(seats).filter(pos => seats[pos].short > 0),
      trickPlayed: integrity.played,
      tricksExpected: integrity.expected,
      duplicateTrickCards: integrity.duplicates,
      ok: orphans.length === 0 && !integrity.corrupt && !Object.keys(seats).some(pos => seats[pos].short > 0),
    };
  }

  // Count each seat's cards and hand any card that belongs to nobody back to the seat that
  // is short. The declarer is repaired first: an empty declarer hand with an unplayed
  // reserved trump is exactly what strands the last trick. Repair happens only when the
  // stray cards exactly account for the shortfall, so a partially dealt hand is reported
  // rather than topped up with invented cards.
  reconcileHands(reason = '') {
    const audit = this.handAudit();
    if (!audit || audit.ok) return null;
    const { orphanCards, seats } = audit;
    const dPos = this.declarer && this.declarer.position;
    const short = Object.keys(seats)
      .filter(pos => seats[pos].short > 0)
      .map(pos => ({ position: pos, hand: this.seatHand(pos), need: seats[pos].short, counted: seats[pos].counted }));
    const orphans = orphanCards.map(k => new Card(k.slice(0, 1), k.slice(1)));
    const integrity = this.trickIntegrity();
    const missing = orphans.length;
    const shortfall = short.reduce((n, s) => n + s.need, 0);
    // Only repair a hand that is genuinely in play. Three guards keep this from inventing
    // cards: the hand must have been dealt in full (see _handDealtComplete), nothing may
    // be left undealt, and no seat may be sitting on zero cards. A short-but-not-empty
    // seat is the lost-card case; an empty seat means the deal never completed, and
    // topping it up would fabricate cards rather than recover them.
    const emptySeats = short.filter(s => s.counted === 0).map(s => s.position);
    const dealComplete = this._handDealtComplete === true && this.deck.length === 0 && emptySeats.length === 0;
    const repairs = [];
    if (dealComplete && missing > 0 && missing === shortfall) {
      short.sort((a, b) => (b.position === dPos ? 1 : 0) - (a.position === dPos ? 1 : 0));
      for (const s of short) {
        for (const card of orphans.splice(0, s.need)) {
          s.hand.push(card);
          repairs.push({ position: s.position, card: card.toString() });
          this.logEvent('card_restored', { position: s.position, card: card.toString(), reason });
        }
      }
    }
    const report = {
      reason,
      missingCards: missing,
      repairs,
      unrecovered: orphans.length,
      dealComplete,
      emptySeats,
      shortSeats: short.map(s => ({ position: s.position, counted: s.counted, expected: HAND_SIZE })),
      cardsPlayed: integrity.played,
      tricksExpected: integrity.expected,
      duplicateTrickCards: integrity.duplicates,
    };
    this.logIntegrity(report);
    return report;
  }

  // The array that actually holds a seat's cards - a live player's hand, or the saved
  // hand of a vacated seat. Null when the seat is not in the hand at all.
  seatHand(pos) {
    const live = this.players.find(p => p.position === pos);
    if (live) return live.hand;
    const v = this.vacatedHands[pos];
    return v && Array.isArray(v.hand) ? v.hand : null;
  }

  // A seat on turn with no cards and no reserved trump can never act - the table would sit
  // on "X's turn" forever. Surfaced in getGameState so it can be announced rather than hang.
  stuckSeat() {
    if (this.state !== 'playing') return null;
    const cur = this.currentPlayer;
    const pos = cur && cur.position;
    if (!pos) return null;
    const live = this.players.find(p => p.position === pos);
    const hand = this.seatHand(pos);
    if (!hand) return null;
    const hasReserved = pos === (this.declarer && this.declarer.position) && !!this.trumpCard && !this.trumpCardPlayed;
    if (hand.length > 0 || hasReserved) return null;
    return { position: pos, name: (live && live.name) || cur.name || pos };
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
    // Seal the hand log before the next hand overwrites it, so the finished hand's full
    // 6-trick trace stays available for debugging until the next hand starts.
    if (this.lastHandLog) {
      this.lastHandLog.result = {
        handNumber: this.lastHandLog.handNumber,
        declarer: this.declarer.position,
        bid,
        declarerTeam,
        declarerTricks,
        declarerHCP,
        required: bidRequirement(bid),
        made: declarerHCP >= bidRequirement(bid),
        winnerTeam,
        points: pts,
        scores: { 'N-S': this.scores['N-S'], 'E-W': this.scores['E-W'] },
        tricks: this.trickHistory.map(t => ({
          trick: t.trickNumber,
          cards: t.cards.map(c => `${c.position}:${c.rank}${c.suit}`),
          winner: t.winnerPosition,
          winnerTeam: t.winnerTeam,
          points: t.winnerPoints,
        })),
      };
      console.log(`[hand ${this.lastHandLog.handNumber}] complete: declarer ${this.declarer.position} bid ${bid}, made ${declarerHCP}/${bidRequirement(bid)}, ${winnerTeam} +${pts}, plays=${this.lastHandLog.plays.length}, repairs=${this.lastHandLog.integrity.length}`);
    }
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
    this.startHandLog();
    this.setupDeck();
    this.dealCards(4);
    this.currentPlayer = this.dealer ? this.seatAfter(this.dealer.position) : null;
    this.state = 'bidding';
    this.logEvent('bidding_start', { dealer: this.dealer ? this.dealer.position : null, lead: (this.currentPlayer || {}).position });
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
      redealPending: this.redealPending ? { ...this.redealPending } : null,
      // A seat on turn with nothing to play would otherwise hang the table silently.
      stuckSeat: this.stuckSeat()
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
        // Hand trace for debugging: every play of all 6 tricks, the reserved-trump
        // lifecycle, any integrity repair and the final result. Overwritten each hand.
        state.lastHandLog = this.lastHandLog ? JSON.parse(JSON.stringify(this.lastHandLog)) : null;
        // Read-only card audit: cards accounted for per seat vs the 6 each should hold.
        state.handIntegrity = this.handAudit();
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
