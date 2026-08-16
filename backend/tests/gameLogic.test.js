"use strict";
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Game, Card, RANK_ORDER, HCP_VALUES, WINNING_SCORE, bidRequirement } = require('../src/gameLogic.js');

const C = (suit, rank) => new Card(suit, rank);
const partner = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Builds a game with a host admin and 4 seated players (N/S/E/W).
function makeGame() {
  const g = new Game('test-room');
  g.addPlayer('Admin', true);
  const ids = {};
  for (const name of ['North', 'South', 'East', 'West']) {
    ids[name] = g.addPlayer(name);
  }
  for (const [name, pos] of [['North', 'N'], ['South', 'S'], ['East', 'E'], ['West', 'W']]) {
    g.setPosition(ids[name].id, pos);
  }
  return { g, ids };
}

function playerAt(g, pos) {
  return g.players.find(p => p.position === pos);
}

function setHand(g, pos, cards) {
  const p = playerAt(g, pos);
  p.hand = cards.map(c => C(c.suit, c.rank));
  return p;
}

// Drives a game into the 'playing' state with deterministic hands.
// hands[declarer] is the hand BEFORE trump selection and must include a card of trumpSuit.
function setupPlaying(g, { declarer = 'N', dealer = 'N', trumpSuit = '♥', bid = 60, hands }) {
  g.state = 'bidding';
  g.dealer = playerAt(g, dealer);
  g.currentPlayer = playerAt(g, declarer);
  g.highestBid = bid;
  g.passCount = 0;
  g.lastBidder = playerAt(g, declarer);
  g.declarer = playerAt(g, declarer);
  g.dummy = playerAt(g, partner[declarer]);
  g.declarer.bid = bid;
  g.contractLevel = bid < 100 ? 1 : 2;
  g.targetTricks = g.contractLevel === 1 ? 4 : 5;
  const trump = hands[declarer].find(c => c.suit === trumpSuit);
  assert.ok(trump, 'declarer hand must include a trump-suit card');
  setHand(g, declarer, hands[declarer]);
  g.state = 'trump_selection';
  assert.ok(g.selectTrump(g.declarer.id, { suit: trumpSuit, rank: trump.rank }), 'selectTrump should succeed');
  for (const pos of ['N', 'S', 'E', 'W']) {
    if (pos !== declarer) setHand(g, pos, hands[pos]);
  }
  g.currentTrick = [];
  g.trickNumber = 0;
  g.leadSuit = null;
  g.currentPlayer = g.seatAfter(g.dealer.position);
  return g;
}

// Plays one full trick; `cards` must be in clockwise order starting at the leader.
function playOneTrick(g, cards) {
  for (const c of cards) {
    const p = playerAt(g, c.pos);
    assert.ok(g.playCard(p.id, { suit: c.suit, rank: c.rank }), `play ${c.suit}${c.rank} for ${c.pos}`);
  }
}

// Default deterministic hands (trump ♥, declarer N).
const DEFAULT_HANDS = {
  N: [C('♥', 'Q'), C('♠', 'J'), C('♠', '9'), C('♦', 'A'), C('♣', 'K')],
  E: [C('♠', 'A'), C('♠', 'K'), C('♥', '10'), C('♦', 'J')],
  S: [C('♠', 'Q'), C('♥', '9'), C('♥', 'K'), C('♣', 'A')],
  W: [C('♠', '10'), C('♥', 'A'), C('♣', 'J'), C('♦', 'Q')],
};

describe('deck & cards', () => {
  it('builds 24 unique cards (6 ranks x 4 suits)', () => {
    const g = new Game();
    g.setupDeck();
    assert.equal(g.deck.length, 24);
    assert.equal(new Set(g.deck.map(c => c.toString())).size, 24);
  });

  it('rank order is J > 9 > A > 10 > K > Q', () => {
    assert.equal(RANK_ORDER.J, 6);
    assert.equal(RANK_ORDER['9'], 5);
    assert.equal(RANK_ORDER.A, 4);
    assert.equal(RANK_ORDER['10'], 3);
    assert.equal(RANK_ORDER.K, 2);
    assert.equal(RANK_ORDER.Q, 1);
  });

  it('HCP values are J=30 9=20 A=15 10=10 K=5 Q=5', () => {
    assert.equal(HCP_VALUES.J, 30);
    assert.equal(HCP_VALUES['9'], 20);
    assert.equal(HCP_VALUES.A, 15);
    assert.equal(HCP_VALUES['10'], 10);
    assert.equal(HCP_VALUES.K, 5);
    assert.equal(HCP_VALUES.Q, 5);
    assert.equal(new Card('♠', 'J').hcp, 30);
  });

  it('bidRequirement table', () => {
    assert.equal(bidRequirement(50), 160);
    assert.equal(bidRequirement(60), 175);
    assert.equal(bidRequirement(100), 235);
    assert.equal(bidRequirement(170), 340);
  });

  it('Card.equals matches suit+rank', () => {
    assert.ok(C('♠', 'J').equals({ suit: '♠', rank: 'J' }));
    assert.ok(!C('♠', 'J').equals({ suit: '♥', rank: 'J' }));
    assert.ok(!C('♠', 'J').equals(null));
  });
});

describe('players & viewers', () => {
  it('the first player becomes a host-only admin', () => {
    const g = new Game();
    const a = g.addPlayer('Admin', true);
    assert.equal(g.admin.id, a.id);
    assert.ok(a.isAdmin);
    assert.equal(g.players.length, 0);
    assert.equal(g.addPlayer('Second', true), null, 'only one admin allowed');
  });

  it('rejects duplicate and blank names', () => {
    const { g } = makeGame();
    assert.equal(g.addPlayer('North'), null, 'duplicate name rejected');
    assert.equal(g.addPlayer('north'), null, 'case-insensitive duplicate rejected');
    assert.equal(g.addPlayer(''), null);
    assert.equal(g.addPlayer('   '), null);
  });

  it('truncates names to 20 characters', () => {
    const g = new Game();
    const p = g.addPlayer('x'.repeat(30), true);
    assert.equal(p.name.length, 20);
  });

  it('caps total viewers at 25', () => {
    const g = new Game();
    g.addPlayer('Admin', true);
    for (let i = 0; i < 24; i++) g.addPlayer('P' + i);
    assert.equal(g.countViewers(), 25);
    assert.equal(g.addPlayer('Overflow'), null);
  });
});

describe('positions & teams', () => {
  it('assigns teams by position', () => {
    const { g } = makeGame();
    assert.equal(playerAt(g, 'N').team, 'N-S');
    assert.equal(playerAt(g, 'S').team, 'N-S');
    assert.equal(playerAt(g, 'E').team, 'E-W');
    assert.equal(playerAt(g, 'W').team, 'E-W');
  });

  it('moving a player clears the old seat', () => {
    const { g, ids } = makeGame();
    g.setPosition(ids.North.id, 'E');
    assert.equal(ids.North.position, 'E');
    assert.equal(ids.North.team, 'E-W');
    assert.equal(g.positions.N, undefined);
  });

  it('rejects an invalid position', () => {
    const { g, ids } = makeGame();
    assert.ok(!g.setPosition(ids.North.id, 'X'));
  });
});

describe('cut & dealer', () => {
  it('startCut requires 4 seated players and deals one cut card each', () => {
    const { g } = makeGame();
    assert.ok(g.startCut());
    assert.equal(g.state, 'cut');
    for (const p of g.players) assert.ok(p.cutCard, p.name + ' has a cut card');
  });

  it('startCut fails with fewer than 4 players', () => {
    const g = new Game('x');
    g.addPlayer('Admin', true);
    g.addPlayer('A'); g.addPlayer('B'); g.addPlayer('C');
    assert.ok(!g.startCut());
  });

  it('the dealer is the highest cut card (J beats A)', () => {
    const { g } = makeGame();
    g.state = 'cut';
    playerAt(g, 'N').cutCard = C('♠', 'J');
    playerAt(g, 'S').cutCard = C('♠', 'A');
    playerAt(g, 'E').cutCard = C('♠', 'K');
    playerAt(g, 'W').cutCard = C('♠', 'Q');
    g.determineDealer();
    assert.equal(g.dealer, playerAt(g, 'N'));
  });

  it('deals 4 cards and bidding starts left of the dealer', () => {
    const { g } = makeGame();
    g.state = 'cut';
    playerAt(g, 'N').cutCard = C('♠', '9');
    playerAt(g, 'S').cutCard = C('♠', 'Q');
    playerAt(g, 'E').cutCard = C('♠', 'K');
    playerAt(g, 'W').cutCard = C('♠', '10');
    g.determineDealer();
    assert.equal(g.state, 'bidding');
    assert.equal(g.dealer, playerAt(g, 'N'));
    assert.equal(g.currentPlayer, playerAt(g, 'E'));
    for (const p of g.players) assert.equal(p.hand.length, 4);
  });
});

describe('bidding', () => {
  function biddingGame() {
    const { g } = makeGame();
    g.state = 'bidding';
    g.dealer = playerAt(g, 'N');
    g.currentPlayer = playerAt(g, 'E');
    g.highestBid = null; g.passCount = 0; g.lastBidder = null;
    return g;
  }

  it('accepts a valid opening bid and advances the turn', () => {
    const g = biddingGame();
    assert.ok(g.placeBid(playerAt(g, 'E').id, 50));
    assert.equal(g.highestBid, 50);
    assert.equal(g.lastBidder, playerAt(g, 'E'));
    assert.equal(g.passCount, 0);
    assert.equal(g.currentPlayer, playerAt(g, 'S'));
  });

  it('rejects low, non-multiple-of-10, and non-increasing bids', () => {
    const g = biddingGame();
    assert.ok(g.placeBid(playerAt(g, 'E').id, 50));
    assert.ok(!g.placeBid(playerAt(g, 'S').id, 50), 'must exceed the high bid');
    assert.ok(!g.placeBid(playerAt(g, 'S').id, 40), 'below minimum');
    assert.ok(!g.placeBid(playerAt(g, 'S').id, 65), 'not a multiple of 10');
    assert.ok(!g.placeBid(playerAt(g, 'S').id, 180), 'above maximum');
    assert.ok(g.placeBid(playerAt(g, 'S').id, 60));
    assert.equal(g.currentPlayer, playerAt(g, 'W'));
  });

  it('only the current player may bid', () => {
    const g = biddingGame();
    assert.ok(!g.placeBid(playerAt(g, 'S').id, 50), "E is first to bid");
    assert.ok(!g.placeBid('no-such-id', 50));
  });

  it('3 passes after a bid declare the last bidder', () => {
    const g = biddingGame();
    g.placeBid(playerAt(g, 'E').id, 60);
    g.placeBid(playerAt(g, 'S').id, 'pass');
    g.placeBid(playerAt(g, 'W').id, 'pass');
    g.placeBid(playerAt(g, 'N').id, 'pass');
    assert.equal(g.state, 'trump_selection');
    assert.equal(g.declarer, playerAt(g, 'E'));
    assert.equal(g.dummy, playerAt(g, 'W'), 'partner of East');
    assert.equal(g.currentPlayer, g.declarer);
  });

  it('all 4 passing re-deals the hand', () => {
    const g = biddingGame();
    g.placeBid(playerAt(g, 'E').id, 'pass');
    g.placeBid(playerAt(g, 'S').id, 'pass');
    g.placeBid(playerAt(g, 'W').id, 'pass');
    g.placeBid(playerAt(g, 'N').id, 'pass');
    assert.equal(g.state, 'bidding');
    assert.equal(g.highestBid, null);
    assert.equal(g.passCount, 0);
    for (const p of g.players) assert.equal(p.hand.length, 4, 'fresh deal');
  });

  it('contract level 1 for bids below 100', () => {
    const g = biddingGame();
    g.placeBid(playerAt(g, 'E').id, 90);
    g.placeBid(playerAt(g, 'S').id, 'pass');
    g.placeBid(playerAt(g, 'W').id, 'pass');
    g.placeBid(playerAt(g, 'N').id, 'pass');
    assert.equal(g.contractLevel, 1);
    assert.equal(g.targetTricks, 4);
  });

  it('contract level 2 for bids >= 100', () => {
    const g = biddingGame();
    g.placeBid(playerAt(g, 'E').id, 100);
    g.placeBid(playerAt(g, 'S').id, 'pass');
    g.placeBid(playerAt(g, 'W').id, 'pass');
    g.placeBid(playerAt(g, 'N').id, 'pass');
    assert.equal(g.contractLevel, 2);
    assert.equal(g.targetTricks, 5);
  });
});

describe('trump selection', () => {
  it('only the declarer may select trump', () => {
    const { g } = makeGame();
    g.state = 'trump_selection';
    g.dealer = playerAt(g, 'N');
    g.declarer = playerAt(g, 'N');
    setHand(g, 'N', [C('♥', 'Q'), C('♠', 'J'), C('♠', '9'), C('♣', 'K')]);
    assert.ok(!g.selectTrump(playerAt(g, 'S').id, { suit: '♥', rank: 'Q' }));
    assert.ok(g.selectTrump(playerAt(g, 'N').id, { suit: '♥', rank: 'Q' }));
  });

  it('reserves the trump card outside the hand and moves to playing', () => {
    const { g } = makeGame();
    g.state = 'trump_selection';
    g.dealer = playerAt(g, 'N');
    g.declarer = playerAt(g, 'N');
    setHand(g, 'N', [C('♥', 'Q'), C('♠', 'J'), C('♠', '9'), C('♣', 'K')]);
    assert.ok(g.selectTrump(playerAt(g, 'N').id, { suit: '♥', rank: 'Q' }));
    assert.equal(g.state, 'playing');
    assert.equal(g.trumpSuit, '♥');
    assert.equal(g.trumpCard.toString(), 'Q♥');
    assert.ok(!playerAt(g, 'N').hand.some(c => c.suit === '♥' && c.rank === 'Q'), 'card removed from hand');
  });

  it('rejects a card not in the declarer hand', () => {
    const { g } = makeGame();
    g.state = 'trump_selection';
    g.declarer = playerAt(g, 'N');
    setHand(g, 'N', [C('♥', 'Q')]);
    assert.ok(!g.selectTrump(playerAt(g, 'N').id, { suit: '♣', rank: 'A' }));
    assert.equal(g.state, 'trump_selection');
  });
});

describe('playing & trick resolution', () => {
  it('follows suit and resolves J over A; HCP goes to the winning team', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    assert.equal(g.currentPlayer, playerAt(g, 'E'), 'bidding starts left of dealer N');
    playOneTrick(g, [
      { pos: 'E', suit: '♠', rank: 'A' },
      { pos: 'S', suit: '♠', rank: 'Q' },
      { pos: 'W', suit: '♠', rank: '10' },
      { pos: 'N', suit: '♠', rank: 'J' },
    ]);
    assert.equal(g.currentTrick.length, 0);
    assert.equal(g.trickNumber, 1);
    assert.equal(g.trickHistory.length, 1);
    assert.equal(g.trickHistory[0].winnerTeam, 'N-S');
    assert.equal(g.teamTricks['N-S'], 1);
    assert.equal(g.teamPoints['N-S'], 15 + 5 + 10 + 30, 'A15+Q5+10-10+J30');
    assert.equal(g.currentPlayer, playerAt(g, 'N'), 'winner leads the next trick');
  });

  it('rejects playing off-suit while holding the led suit', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    assert.ok(g.playCard(playerAt(g, 'E').id, { suit: '♠', rank: 'A' }));
    const south = playerAt(g, 'S');
    assert.ok(!g.playCard(south.id, { suit: '♥', rank: 'K' }), 'South holds ♠Q, must follow spades');
    assert.equal(south.hand.length, 4, 'card returned to hand');
    assert.ok(g.playCard(south.id, { suit: '♠', rank: 'Q' }));
  });

  it('only the current player may play', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    assert.ok(!g.playCard(playerAt(g, 'N').id, { suit: '♠', rank: 'J' }), "E's turn, not N");
    assert.ok(!g.playCard(playerAt(g, 'E').id, { suit: '♥', rank: 'X' }), 'card must be in hand');
    assert.ok(g.playCard(playerAt(g, 'E').id, { suit: '♠', rank: 'A' }));
  });

  it('an unrevealed trump cannot beat the led suit', () => {
    const { g } = makeGame();
    setupPlaying(g, {
      declarer: 'N', dealer: 'N', trumpSuit: '♥',
      hands: {
        N: [C('♥', 'Q'), C('♠', '10'), C('♠', '9'), C('♦', 'A'), C('♣', 'K')],
        E: [C('♠', 'A'), C('♦', 'J'), C('♥', '10'), C('♣', 'Q')],
        S: [C('♥', '9'), C('♦', 'K'), C('♥', 'K'), C('♣', 'A')],
        W: [C('♠', 'K'), C('♦', 'Q'), C('♥', 'A'), C('♣', 'J')],
      },
    });
    playOneTrick(g, [
      { pos: 'E', suit: '♠', rank: 'A' },
      { pos: 'S', suit: '♥', rank: '9' },
      { pos: 'W', suit: '♠', rank: 'K' },
      { pos: 'N', suit: '♠', rank: '10' },
    ]);
    assert.equal(g.trickHistory[0].winnerTeam, 'E-W', 'led suit A wins, trump not active');
    assert.equal(g.teamPoints['E-W'], 15 + 20 + 5 + 10);
  });

  it('a revealed trump beats the led suit', () => {
    const { g } = makeGame();
    setupPlaying(g, {
      declarer: 'N', dealer: 'N', trumpSuit: '♥',
      hands: {
        N: [C('♥', 'Q'), C('♠', '10'), C('♠', '9'), C('♦', 'A'), C('♣', 'K')],
        E: [C('♠', 'A'), C('♦', 'J'), C('♥', '10'), C('♣', 'Q')],
        S: [C('♥', '9'), C('♦', 'K'), C('♥', 'K'), C('♣', 'A')],
        W: [C('♠', 'K'), C('♦', 'Q'), C('♥', 'A'), C('♣', 'J')],
      },
    });
    assert.ok(g.playCard(playerAt(g, 'E').id, { suit: '♠', rank: 'A' }));
    assert.ok(g.askTrump(playerAt(g, 'S').id), 'defender reveals trump');
    playOneTrick(g, [
      { pos: 'S', suit: '♥', rank: '9' },
      { pos: 'W', suit: '♠', rank: 'K' },
      { pos: 'N', suit: '♠', rank: '10' },
    ]);
    assert.equal(g.trickHistory[0].winnerTeam, 'N-S', 'trump 9♥ beats the spade lead');
    assert.equal(g.teamPoints['N-S'], 15 + 20 + 5 + 10, 'winner team tallies all cards in the trick');
  });

  it('6 tricks advance to hand review', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    for (let i = 0; i < 6; i++) {
      g.currentTrick = [
        { player: playerAt(g, 'N'), card: C('♠', 'J') },
        { player: playerAt(g, 'E'), card: C('♠', 'A') },
        { player: playerAt(g, 'S'), card: C('♠', 'Q') },
        { player: playerAt(g, 'W'), card: C('♠', 'K') },
      ];
      g.endTrick();
    }
    assert.equal(g.trickHistory.length, 6);
    assert.equal(g.state, 'hand_review');
    assert.equal(g.currentPlayer, null);
    assert.equal(g.teamTricks['N-S'], 6);
  });
});

describe('askTrump / playTrumpCard', () => {
  it('a non-declarer reveals and the reserved card rejoins the declarer hand', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const before = playerAt(g, 'N').hand.length;
    assert.ok(g.playCard(playerAt(g, 'E').id, { suit: '♠', rank: 'A' }), 'lead so asking is legal');
    assert.ok(g.askTrump(playerAt(g, 'S').id));
    assert.ok(g.trumpRevealed);
    assert.equal(g.trumpCard, null);
    assert.equal(playerAt(g, 'N').hand.length, before + 1, 'reserved card returns to hand');
    assert.ok(playerAt(g, 'N').hand.some(c => c.suit === '♥' && c.rank === 'Q'));
  });

  it('the declarer cannot ask', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    assert.ok(g.playCard(playerAt(g, 'E').id, { suit: '♠', rank: 'A' }));
    assert.ok(!g.askTrump(playerAt(g, 'N').id), 'declarer may not ask');
    assert.ok(!g.trumpRevealed, 'failed ask leaves trump hidden');
  });

  it('cannot ask while leading an empty trick', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    assert.ok(!g.askTrump(playerAt(g, 'S').id), 'no cards in the trick yet');
  });

  it('playTrumpCard reveals and plays the reserved card when the declarer cannot follow', () => {
    const { g } = makeGame();
    setupPlaying(g, {
      declarer: 'N', dealer: 'S', trumpSuit: '♥',
      hands: {
        N: [C('♥', 'Q'), C('♦', 'A'), C('♦', 'K'), C('♣', 'J'), C('♣', 'K')],
        W: [C('♠', 'A'), C('♠', 'K'), C('♥', '10'), C('♣', 'Q')],
        E: [C('♠', 'Q'), C('♦', 'J'), C('♥', '9'), C('♣', 'A')],
        S: [C('♠', 'J'), C('♦', 'Q'), C('♥', 'K'), C('♦', '10')],
      },
    });
    assert.equal(g.currentPlayer, playerAt(g, 'W'), 'left of dealer S');
    assert.ok(g.playCard(playerAt(g, 'W').id, { suit: '♠', rank: 'A' }), 'West leads spades');
    assert.equal(g.currentPlayer, playerAt(g, 'N'), "declarer N's turn");
    assert.ok(g.playTrumpCard(playerAt(g, 'N').id));
    assert.ok(g.trumpRevealed);
    assert.equal(g.trumpCard, null);
    assert.equal(g.currentTrick.length, 2);
  });

  it('playTrumpCard is rejected while leading before the final trick', () => {
    const { g } = makeGame();
    setupPlaying(g, {
      declarer: 'N', dealer: 'W', trumpSuit: '♥',
      hands: {
        N: [C('♥', 'Q'), C('♦', 'A'), C('♦', 'K'), C('♣', 'J'), C('♣', 'K')],
        W: [C('♠', 'A'), C('♠', 'K'), C('♥', '10'), C('♣', 'Q')],
        E: [C('♠', 'Q'), C('♦', 'J'), C('♥', '9'), C('♣', 'A')],
        S: [C('♠', 'J'), C('♦', 'Q'), C('♥', 'K'), C('♦', '10')],
      },
    });
    assert.equal(g.currentPlayer, playerAt(g, 'N'), 'left of dealer W');
    assert.ok(!g.playTrumpCard(playerAt(g, 'N').id), 'cannot lead the reserved trump before trick 5');
  });

  it('playTrumpCard is allowed on the final trick even when leading', () => {
    const { g } = makeGame();
    setupPlaying(g, {
      declarer: 'N', dealer: 'W', trumpSuit: '♥',
      hands: {
        N: [C('♥', 'Q'), C('♦', 'A'), C('♦', 'K'), C('♣', 'J'), C('♣', 'K')],
        W: [C('♠', 'A'), C('♠', 'K'), C('♥', '10'), C('♣', 'Q')],
        E: [C('♠', 'Q'), C('♦', 'J'), C('♥', '9'), C('♣', 'A')],
        S: [C('♠', 'J'), C('♦', 'Q'), C('♥', 'K'), C('♦', '10')],
      },
    });
    g.trickNumber = 5;
    assert.ok(g.playTrumpCard(playerAt(g, 'N').id), 'final trick, leading is allowed');
    assert.ok(g.trumpRevealed);
  });
});

describe('vacated seats (disconnect)', () => {
  it('mid-game removal saves the seat and vacates the turn', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const east = playerAt(g, 'E');
    g.removePlayer(east.id);
    assert.ok(g.vacatedHands.E, 'seat saved');
    assert.equal(g.vacatedHands.E.hand.length, east.hand.length);
    assert.equal(g.currentPlayer.id, null, 'turn becomes a vacated pseudo-player');
    assert.equal(g.currentPlayer.position, 'E');
  });

  it('the admin can bid for a vacated seat', () => {
    const { g } = makeGame();
    g.state = 'bidding';
    g.dealer = playerAt(g, 'N');
    g.currentPlayer = playerAt(g, 'E');
    g.highestBid = null; g.passCount = 0; g.lastBidder = null;
    g.removePlayer(playerAt(g, 'E').id);
    assert.ok(g.placeVacatedBid('E', 60));
    assert.equal(g.highestBid, 60);
    assert.equal(g.currentPlayer, playerAt(g, 'S'));
  });

  it('the admin can play for a vacated seat', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const east = playerAt(g, 'E');
    const savedHand = east.hand.map(c => ({ suit: c.suit, rank: c.rank }));
    g.removePlayer(east.id);
    assert.ok(g.playVacatedCard('E', savedHand[0]));
    assert.equal(g.vacatedHands.E.hand.length, savedHand.length - 1);
    assert.equal(g.currentTrick.length, 1);
  });

  it('promoting a spectator restores the saved state and turn', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const east = playerAt(g, 'E');
    const savedHand = east.hand.map(c => ({ suit: c.suit, rank: c.rank }));
    g.removePlayer(east.id);
    const spec = g.addSpectator('NewPlayer');
    const p = g.promoteSpectator(g.admin.id, spec.id, 'E');
    assert.ok(p);
    assert.equal(g.positions.E, p.id);
    assert.equal(p.hand.length, savedHand.length, 'hand restored');
    assert.equal(g.currentPlayer, p, 'turn restored to the promoted player');
    assert.ok(!g.vacatedHands.E, 'vacated entry cleared');
  });

  it('names held by a vacated seat are blocked from reuse', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    g.removePlayer(playerAt(g, 'E').id);
    assert.ok(g.getViewerName('East'), 'vacated name still in use');
    assert.equal(g.addPlayer('East'), null);
  });
});

describe('scoring (confirmHand)', () => {
  function reviewGame(bid = 60) {
    const { g } = makeGame();
    g.state = 'hand_review';
    g.declarer = playerAt(g, 'N');
    g.declarer.bid = bid;
    return g;
  }

  it('declarer team scores 1 for a level-1 contract made', () => {
    const g = reviewGame(60);
    g.teamPoints['N-S'] = 175;
    g.teamTricks['N-S'] = 4;
    assert.ok(g.confirmHand(g.admin.id));
    assert.equal(g.scores['N-S'], 1);
    assert.equal(g.scores['E-W'], 0);
    assert.equal(g.state, 'bidding', 'next hand begins');
  });

  it('level-2 contract made scores 2', () => {
    const g = reviewGame(100);
    g.teamPoints['N-S'] = 240;
    assert.ok(g.confirmHand(g.admin.id));
    assert.equal(g.scores['N-S'], 2);
  });

  it('a failed contract gives the defenders double points', () => {
    const g = reviewGame(100);
    g.teamPoints['N-S'] = 180;
    assert.ok(g.confirmHand(g.admin.id));
    assert.equal(g.scores['E-W'], 4, 'basePts 2 x 2');
  });

  it('a failed level-1 contract gives the defenders 2', () => {
    const g = reviewGame(60);
    g.teamPoints['N-S'] = 170;
    assert.ok(g.confirmHand(g.admin.id));
    assert.equal(g.scores['E-W'], 2);
  });

  it('a slam adds a bonus point', () => {
    const g = reviewGame(60);
    g.teamPoints['N-S'] = 340;
    assert.ok(g.confirmHand(g.admin.id));
    assert.equal(g.scores['N-S'], 2, '1 base + 1 slam');
  });

  it('reaching the winning score ends the game', () => {
    const g = reviewGame(60);
    g.scores['N-S'] = 11;
    g.teamPoints['N-S'] = 200;
    assert.ok(g.confirmHand(g.admin.id));
    assert.equal(g.state, 'game_over');
    assert.equal(g.winner, 'N-S');
  });

  it('only the admin can confirm the hand', () => {
    const g = reviewGame(60);
    g.teamPoints['N-S'] = 175;
    assert.ok(!g.confirmHand(playerAt(g, 'N').id));
    assert.equal(g.state, 'hand_review');
  });
});

describe('resetForNextHand', () => {
  it('rotates the dealer and starts a fresh bidding hand', () => {
    const { g } = makeGame();
    g.dealer = playerAt(g, 'N');
    g.resetForNextHand(true);
    assert.equal(g.state, 'bidding');
    assert.equal(g.dealer, playerAt(g, 'E'), 'dealer rotates clockwise');
    assert.equal(g.currentPlayer, playerAt(g, 'S'), 'bidding starts left of the new dealer');
    assert.equal(g.highestBid, null);
    for (const p of g.players) assert.equal(p.hand.length, 4);
  });
});

describe('resetForNewGame', () => {
  it('keeps players, admin, positions, and spectators but zeroes the board and returns to waiting', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    g.scores = { 'N-S': 7, 'E-W': 3 };
    g.winner = 'N-S';
    g.state = 'game_over';
    g.addSpectator('Watcher');
    const playersBefore = g.players.map(p => p.id).sort();
    const positionsBefore = { ...g.positions };
    const spectatorsBefore = g.spectators.map(s => s.id).sort();
    const adminId = g.admin.id;
    g.resetForNewGame();
    assert.equal(g.state, 'waiting');
    assert.equal(g.scores['N-S'], 0);
    assert.equal(g.scores['E-W'], 0);
    assert.equal(g.winner, null);
    assert.equal(g.declarer, null);
    assert.deepEqual(g.players.map(p => p.id).sort(), playersBefore, 'players stay seated');
    assert.equal(g.admin.id, adminId, 'admin is preserved');
    assert.deepEqual(g.positions, positionsBefore, 'positions preserved');
    assert.deepEqual(g.spectators.map(s => s.id).sort(), spectatorsBefore, 'spectators preserved');
    for (const p of g.players) {
      assert.equal(p.hand.length, 0);
      assert.equal(p.bid, null);
      assert.equal(p.score, 0);
    }
  });
});

describe('getGameState visibility', () => {
  it('the declarer sees trump and their hand; others do not see trump', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const d = g.getGameState(playerAt(g, 'N').id);
    assert.equal(d.trumpSuit, '♥');
    assert.equal(d.trumpCard.rank, 'Q');
    assert.equal(d.me.hand.length, 4);

    const e = g.getGameState(playerAt(g, 'E').id);
    assert.equal(e.trumpSuit, null, 'trump hidden from others');
    assert.equal(e.trumpCard, null);
    assert.equal(e.me.hand.length, 4);
    const south = e.players.find(p => p.position === 'S');
    assert.ok(!south.hand, 'dummy hand is hidden from everyone');
    assert.ok(south.cardCount >= 0);
  });

  it('the admin sees no hands, only card counts', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const a = g.getGameState(g.admin.id);
    assert.equal(a.trumpSuit, null, 'admin does not see hidden trump');
    for (const p of a.players) {
      assert.ok(!p.hand, p.name + ' hand hidden');
      assert.ok(p.cardCount >= 0);
    }
  });

  it('spectators see only card counts and the cards on the table, not hands', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const spec = g.addSpectator('Watcher');
    const s = g.getGameState(spec.id);
    assert.ok(s.me.isSpectator);
    assert.deepEqual(s.me.hand, [], 'spectator has no hand of their own');
    for (const p of s.players) {
      assert.ok(!p.hand, p.name + ' hand hidden from spectator');
      assert.ok(p.cardCount >= 0, p.name + ' card count shown');
    }
    // Spectators see the cards played on the table during a trick...
    assert.ok(g.playCard(playerAt(g, 'E').id, { suit: '♠', rank: 'A' }));
    const s2 = g.getGameState(spec.id);
    assert.equal(s2.currentTrick.length, 1);
    assert.equal(s2.currentTrick[0].card.suit, '♠');
    assert.equal(s2.currentTrick[0].card.rank, 'A');
    // ...but not the hidden trump
    assert.equal(s2.trumpSuit, null);
    assert.equal(s2.trumpCard, null);
  });
});

describe('persistence (toJSON/fromJSON)', () => {
  it('round-trips players, admin, scores, positions, online flags, and revoked tokens', () => {
    const { g, ids } = makeGame();
    g.scores['N-S'] = 3;
    g.handNumber = 2;
    g.positions = { N: ids.North.id, S: ids.South.id, E: ids.East.id, W: ids.West.id };
    g.getPlayer(ids.North.id).online = false;
    g.revokeToken('some-token');
    const rt = Game.fromJSON(g.toJSON());
    assert.equal(rt.players.length, 4);
    assert.equal(rt.admin.name, 'Admin');
    assert.equal(rt.scores['N-S'], 3);
    assert.equal(rt.handNumber, 2);
    assert.equal(rt.positions.N, ids.North.id);
    assert.equal(rt.getPlayer(ids.North.id).online, false);
    assert.equal(rt.getPlayer(ids.South.id).online, true);
    assert.ok(rt.isTokenRevoked('some-token'));
    assert.ok(!rt.isTokenRevoked('other'));
  });
});

describe('admin actions', () => {
  it('kickPlayer removes a player (admin only)', () => {
    const { g, ids } = makeGame();
    assert.ok(g.kickPlayer(g.admin.id, ids.South.id));
    assert.equal(g.players.length, 3);
    assert.ok(!g.kickPlayer(ids.North.id, ids.East.id), 'non-admin cannot kick');
  });

  it('demoteToSpectator moves a player out of the seats', () => {
    const { g, ids } = makeGame();
    const p = g.demoteToSpectator(g.admin.id, ids.South.id);
    assert.ok(p);
    assert.equal(g.players.length, 3);
    assert.equal(g.spectators.length, 1);
    assert.equal(p.position, null);
    assert.equal(g.positions.S, undefined);
  });

  it('rotateDealer moves the dealer clockwise', () => {
    const { g } = makeGame();
    g.dealer = playerAt(g, 'N');
    assert.ok(g.rotateDealer(g.admin.id));
    assert.equal(g.dealer, playerAt(g, 'E'));
  });

  it('resetScores zeroes the board', () => {
    const { g } = makeGame();
    g.scores = { 'N-S': 5, 'E-W': 3 };
    g.teamPoints = { 'N-S': 100, 'E-W': 60 };
    g.teamTricks = { 'N-S': 2, 'E-W': 4 };
    assert.ok(g.resetScores(g.admin.id));
    assert.deepEqual(g.scores, { 'N-S': 0, 'E-W': 0 });
    assert.deepEqual(g.teamPoints, { 'N-S': 0, 'E-W': 0 });
    assert.deepEqual(g.teamTricks, { 'N-S': 0, 'E-W': 0 });
  });
});

describe('WINNING_SCORE', () => {
  it('is 12 points', () => {
    assert.equal(WINNING_SCORE, 12);
  });
});
