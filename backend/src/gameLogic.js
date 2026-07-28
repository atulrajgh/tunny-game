"use strict";
const { v4: uuidv4 } = require('uuid');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['J', '9', 'A', '10', 'K', 'Q'];
const RANK_ORDER = { J: 6, 9: 5, A: 4, 10: 3, K: 2, Q: 1 };
const HCP_VALUES = { J: 3, 9: 2, A: 1.1, 10: 1, K: 0.3, Q: 0.2 };
const MAX_HANDS = 6;

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
    this.tricksWon = 0;
    this.pointsWon = 0;
    this.team = null;
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
    this.leadSuit = null;
    this.trickNumber = 0;
    this.handNumber = 0;
    this.deck = [];
    this.lastBidder = null;
    this.contractLevel = null;
    this.targetTricks = null;
    this.scores = { 'N-S': 0, 'E-W': 0 };
    this.winner = null;
    this.admin = null;
    this.adminId = null;
    this.positions = {};
    this.roomId = null;
    this.lastActivity = Date.now();
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
    const player = new Player(uuidv4(), name);
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

  removePlayer(playerId) {
    if (this.admin && this.admin.id === playerId) {
      this.admin = null;
      this.adminId = null;
      return true;
    }
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return false;
    this.players.splice(idx, 1);
    for (const [pos, id] of Object.entries(this.positions)) {
      if (id === playerId) delete this.positions[pos];
    }
    this.lastActivity = Date.now();
    return true;
  }

  getPlayer(playerId) {
    if (this.admin && this.admin.id === playerId) return this.admin;
    return this.players.find(p => p.id === playerId);
  }

  setPosition(playerId, pos) {
    if (!['N', 'S', 'E', 'W'].includes(pos)) return false;
    const player = this.getPlayer(playerId);
    if (!player) return false;
    for (const [p, id] of Object.entries(this.positions)) {
      if (id === playerId) delete this.positions[p];
    }
    this.positions[pos] = playerId;
    player.position = pos;
    player.team = (pos === 'N' || pos === 'S') ? 'N-S' : 'E-W';
    this.lastActivity = Date.now();
    return true;
  }

  startCut() {
    if (this.state !== 'waiting') return false;
    if (this.players.length < 4) return false;
    if (Object.keys(this.positions).length < 4) return false;
    this.setupDeck();
    for (const player of this.players) {
      player.cutCard = this.deck.pop();
    }
    this.state = 'cut';
    this.lastActivity = Date.now();
    return true;
  }

  determineDealer() {
    let highest = this.players[0];
    for (const p of this.players) {
      if (RANK_ORDER[p.cutCard.rank] > RANK_ORDER[highest.cutCard.rank]) {
        highest = p;
      }
    }
    this.dealer = highest;
    for (const p of this.players) p.cutCard = null;
    this.setupDeck();
    this.dealCards(4);
    this.currentPlayer = this.getNextPlayer(this.dealer.id);
    this.state = 'bidding';
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

  getPartnerPosition(pos) {
    return { N: 'S', S: 'N', E: 'W', W: 'E' }[pos];
  }

  dealCards(count) {
    for (let i = 0; i < count && this.deck.length > 0; i++) {
      for (const p of this.players) {
        if (this.deck.length > 0) p.hand.push(this.deck.pop());
      }
    }
  }

  placeBid(playerId, bid) {
    if (this.state !== 'bidding') return false;
    if (this.currentPlayer.id !== playerId) return false;
    const player = this.getPlayer(playerId);
    if (!player) return false;
    if (bid === 'pass') {
      player.bid = 'pass';
    } else if (typeof bid === 'number' && bid >= 5 && bid <= 14) {
      player.bid = bid;
      this.lastBidder = player;
    } else {
      return false;
    }
    if (this.players.every(p => p.bid !== null)) {
      if (!this.lastBidder) {
        this.resetForNextHand();
        return true;
      }
      this.state = 'trump_selection';
      this.declarer = this.lastBidder;
      const partnerPos = this.getPartnerPosition(this.declarer.position);
      this.dummy = this.getPlayer(this.positions[partnerPos]);
      this.contractLevel = this.declarer.bid < 10 ? 1 : 2;
      this.targetTricks = this.contractLevel === 1 ? 4 : 5;
      this.currentPlayer = this.declarer;
      this.lastActivity = Date.now();
      return true;
    }
    this.currentPlayer = this.getNextPlayer(playerId);
    this.lastActivity = Date.now();
    return true;
  }

  selectTrump(playerId, cardIndex) {
    if (this.state !== 'trump_selection') return false;
    if (playerId !== this.declarer.id) return false;
    const player = this.getPlayer(playerId);
    if (!player || cardIndex < 0 || cardIndex >= player.hand.length) return false;
    const card = player.hand[cardIndex];
    this.trumpSuit = card.suit;
    this.trumpCard = card;
    this.trumpCardIndex = cardIndex;
    this.dealCards(2);
    this.state = 'playing';
    this.currentTrick = [];
    this.trickNumber = 0;
    this.currentPlayer = this.getNextPlayer(this.dealer.id);
    this.lastActivity = Date.now();
    return true;
  }

  playCard(playerId, card) {
    if (this.state !== 'playing') return false;
    if (this.currentPlayer.id !== playerId) return false;
    const player = this.getPlayer(playerId);
    if (!player) return false;
    const idx = player.hand.findIndex(c => c.equals(card));
    if (idx === -1) return false;
    const played = player.hand.splice(idx, 1)[0];
    if (this.currentTrick.length === 0) {
      this.leadSuit = played.suit;
    } else if (played.suit !== this.leadSuit) {
      const hasSuit = player.hand.some(c => c.suit === this.leadSuit);
      if (hasSuit) { player.hand.splice(idx, 0, played); return false; }
    }
    player.playedCard = played;
    this.currentTrick.push({ player, card: played });
    if (this.currentTrick.length === 4) {
      this.endTrick();
    } else {
      this.currentPlayer = this.getNextPlayer(playerId);
    }
    this.lastActivity = Date.now();
    return true;
  }

  endTrick() {
    let winner = this.currentTrick[0];
    let winningCard = winner.card;
    for (const entry of this.currentTrick) {
      const card = entry.card;
      if (card.suit === this.trumpSuit && winningCard.suit !== this.trumpSuit) {
        winner = entry; winningCard = card;
      } else if (card.suit === winningCard.suit && RANK_ORDER[card.rank] > RANK_ORDER[winningCard.rank]) {
        winner = entry; winningCard = card;
      }
    }
    winner.player.tricksWon++;
    for (const entry of this.currentTrick) winner.player.pointsWon += entry.card.hcp;
    winner.player.pointsWon = Math.round(winner.player.pointsWon * 10) / 10;
    this.currentTrick = [];
    this.currentPlayer = winner.player;
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
    this.trumpRevealed = true;
    this.lastActivity = Date.now();
    return true;
  }

  playTrumpCard(playerId) {
    if (this.state !== 'playing') return false;
    if (playerId !== this.declarer.id) return false;
    const player = this.getPlayer(playerId);
    if (!player || !this.trumpCard) return false;
    if (this.trumpCardPlayed) return false;
    const idx = player.hand.findIndex(c => c.equals(this.trumpCard));
    if (idx === -1) return false;
    if (this.currentTrick.length > 0 && this.leadSuit) {
      const hasSuit = player.hand.some((c, i) => c.suit === this.leadSuit && i !== idx);
      if (hasSuit) return false;
    }
    const played = player.hand.splice(idx, 1)[0];
    this.trumpCardPlayed = true;
    player.playedCard = played;
    this.currentTrick.push({ player, card: played });
    if (this.currentTrick.length === 4) {
      this.endTrick();
    } else {
      this.currentPlayer = this.getNextPlayer(playerId);
    }
    this.lastActivity = Date.now();
    return true;
  }

  confirmHand(adminId) {
    if (this.state !== 'hand_review') return false;
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin) return false;
    const declarerTeam = this.declarer.team;
    const declarerTricks = this.players.filter(p => p.team === declarerTeam).reduce((s, p) => s + p.tricksWon, 0);
    const defendingTeam = declarerTeam === 'N-S' ? 'E-W' : 'N-S';
    if (declarerTricks >= this.targetTricks) {
      this.scores[declarerTeam] += declarerTricks === 6 ? 3 : 1;
    } else {
      this.scores[defendingTeam] += 6 - declarerTricks >= 6 ? 3 : 1;
    }
    for (const p of this.players) p.score = this.scores[p.team] || 0;
    if (this.handNumber >= MAX_HANDS) {
      this.state = 'game_over';
      this.winner = this.scores['N-S'] >= this.scores['E-W'] ? 'N-S' : 'E-W';
    } else {
      this.resetForNextHand();
    }
    this.lastActivity = Date.now();
    return true;
  }

  resetForNextHand() {
    for (const p of this.players) {
      p.hand = []; p.bid = null; p.playedCard = null;
      p.tricksWon = 0; p.pointsWon = 0; p.cutCard = null;
    }
    this.trumpSuit = null; this.trumpCard = null; this.trumpCardIndex = -1;
    this.trumpRevealed = false; this.trumpCardPlayed = false; this.currentTrick = []; this.trickNumber = 0;
    this.declarer = null; this.dummy = null; this.lastBidder = null;
    this.contractLevel = null; this.targetTricks = null;
    this.currentPlayer = null; this.leadSuit = null;
    this.dealer = this.getNextPlayer(this.dealer.id);
    this.setupDeck();
    this.dealCards(4);
    this.currentPlayer = this.getNextPlayer(this.dealer.id);
    this.state = 'bidding';
  }

  kickPlayer(adminId, targetId) {
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin || adminId === targetId) return false;
    return this.removePlayer(targetId);
  }

  rotateDealer(adminId) {
    const admin = this.getPlayer(adminId);
    if (!admin || !admin.isAdmin || !this.dealer) return false;
    this.dealer = this.getNextPlayer(this.dealer.id);
    this.lastActivity = Date.now();
    return true;
  }

  sortHand(hand) {
    return hand.slice().sort((a, b) => {
      const si = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
      return si !== 0 ? si : RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
    });
  }

  getGameState(playerId) {
    const viewer = this.getPlayer(playerId);
    const state = {
      roomId: this.id, state: this.state,
      dealer: this.dealer ? { id: this.dealer.id, name: this.dealer.name, position: this.dealer.position } : null,
      currentPlayer: this.currentPlayer ? { id: this.currentPlayer.id, name: this.currentPlayer.name, position: this.currentPlayer.position } : null,
      trumpSuit: (viewer && (viewer.isAdmin || this.trumpRevealed || viewer.id === this.declarer?.id)) ? this.trumpSuit : null, trumpRevealed: this.trumpRevealed,
      trumpCard: (viewer && (viewer.isAdmin || this.trumpRevealed || viewer.id === this.declarer?.id)) && this.trumpCard && !this.trumpCardPlayed ? { suit: this.trumpCard.suit, rank: this.trumpCard.rank } : null,
      trickNumber: this.trickNumber, handNumber: this.handNumber,
      contractLevel: this.contractLevel, targetTricks: this.targetTricks,
      declarer: this.declarer ? { id: this.declarer.id, position: this.declarer.position } : null,
      scores: { ...this.scores }, winner: this.winner,
      positions: { ...this.positions },
      currentTrick: this.currentTrick.map(e => ({
        playerId: e.player.id, playerName: e.player.name,
        position: e.player.position,
        card: { suit: e.card.suit, rank: e.card.rank }
      }))
    };
    state.admin = this.admin ? { id: this.admin.id, name: this.admin.name } : null;
    if (viewer) {
      state.me = {
        id: viewer.id, name: viewer.name, position: viewer.position,
        hand: viewer.isAdmin ? [] : this.sortHand(viewer.hand).map(c => ({ suit: c.suit, rank: c.rank })),
        isAdmin: viewer.isAdmin, team: viewer.team,
        bid: viewer.bid, score: viewer.score, tricksWon: viewer.tricksWon, pointsWon: viewer.pointsWon,
        cutCard: viewer.cutCard ? { suit: viewer.cutCard.suit, rank: viewer.cutCard.rank } : null
      };
      if (viewer.isAdmin) {
        state.players = this.players.map(p => ({
          id: p.id, name: p.name, position: p.position, team: p.team,
          isAdmin: p.isAdmin, bid: p.bid, score: p.score,
          tricksWon: p.tricksWon, pointsWon: p.pointsWon,
          hand: this.sortHand(p.hand).map(c => ({ suit: c.suit, rank: c.rank }))
        }));
      } else {
        state.players = this.players.map(p => ({
          id: p.id, name: p.name,
          position: p.position, team: p.team,
          isAdmin: p.isAdmin, bid: p.bid, score: p.score,
          tricksWon: p.tricksWon, pointsWon: p.pointsWon,
          hand: (p.id === viewer.id || (this.state === 'playing' && this.dummy && p.id === this.dummy.id))
            ? this.sortHand(p.hand).map(c => ({ suit: c.suit, rank: c.rank })) : undefined,
          cardCount: p.hand.length
        }));
      }
    }
    return state;
  }

  canViewCard(viewer, cardOwner) {
    if (!viewer || !cardOwner) return false;
    if (viewer.isAdmin) return true;
    if (viewer.id === cardOwner.id) return true;
    if (this.dummy && cardOwner.id === this.dummy.id) return true;
    return false;
  }

  toJSON() {
    return {
      id: this.id, roomId: this.roomId, state: this.state,
      players: this.players.map(p => ({
        id: p.id, name: p.name, position: p.position, team: p.team,
        isAdmin: false, bid: p.bid, score: p.score, tricksWon: p.tricksWon, pointsWon: p.pointsWon
      })),
      admin: this.admin ? { id: this.admin.id, name: this.admin.name } : null,
      dealer: this.dealer ? this.dealer.id : null,
      scores: this.scores, winner: this.winner,
      adminId: this.adminId, positions: this.positions,
      handNumber: this.handNumber, lastActivity: this.lastActivity
    };
  }

  static fromJSON(data) {
    const g = new Game(data.id);
    g.roomId = data.roomId; g.state = data.state;
    g.scores = data.scores; g.winner = data.winner;
    g.adminId = data.adminId; g.positions = data.positions;
    g.handNumber = data.handNumber || 0; g.lastActivity = data.lastActivity || Date.now();
    const pMap = {};
    for (const pd of data.players) {
      const p = new Player(pd.id, pd.name);
      p.position = pd.position; p.team = pd.team;
      p.isAdmin = false; p.bid = pd.bid;
      p.score = pd.score || 0; p.tricksWon = pd.tricksWon || 0; p.pointsWon = pd.pointsWon || 0;
      g.players.push(p);
      pMap[pd.id] = p;
    }
    if (data.dealer) g.dealer = pMap[data.dealer] || null;
    if (data.admin) {
      const a = new Player(data.admin.id, data.admin.name);
      a.isAdmin = true;
      g.admin = a;
    }
    return g;
  }

  reset() {
    const savedAdmin = this.admin;
    this.players = []; this.state = 'waiting'; this.dealer = null;
    this.currentPlayer = null; this.declarer = null; this.dummy = null;
    this.trumpSuit = null; this.trumpCard = null; this.trumpCardIndex = -1;
    this.trumpRevealed = false; this.currentTrick = []; this.trickNumber = 0;
    this.handNumber = 0; this.deck = []; this.lastBidder = null;
    this.contractLevel = null; this.targetTricks = null;
    this.scores = { 'N-S': 0, 'E-W': 0 }; this.winner = null;
    this.admin = savedAdmin;
    this.adminId = savedAdmin ? savedAdmin.id : null;
    this.positions = {}; this.leadSuit = null;
  }
}

module.exports = { Game, Player, Card, SUITS, RANKS, RANK_ORDER, HCP_VALUES, MAX_HANDS };
