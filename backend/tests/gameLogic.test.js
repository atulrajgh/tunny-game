"use strict";
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Game, Card, RANK_ORDER, HCP_VALUES, WINNING_SCORE, bidRequirement, BOT_NAMES, MAX_BOTS } = require('../src/gameLogic.js');

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

  it('HCP values are J=30 9=18 A=12 10=10 K=3 Q=2', () => {
    assert.equal(HCP_VALUES.J, 30);
    assert.equal(HCP_VALUES['9'], 18);
    assert.equal(HCP_VALUES.A, 12);
    assert.equal(HCP_VALUES['10'], 10);
    assert.equal(HCP_VALUES.K, 3);
    assert.equal(HCP_VALUES.Q, 2);
    assert.equal(new Card('♠', 'J').hcp, 30);
  });

  it('bidRequirement table', () => {
    assert.equal(bidRequirement(50), 150);
    assert.equal(bidRequirement(60), 160);
    assert.equal(bidRequirement(100), 200);
    assert.equal(bidRequirement(170), 270);
    assert.equal(bidRequirement(200), 300);
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

  it('demote + promote during the cut deals the newcomer a cut card and cannot crash determineDealer', () => {
    const { g, ids } = makeGame();
    assert.ok(g.startCut());
    for (const p of g.players) assert.ok(p.cutCard, 'every seat cut at the start');
    const bot = g.addBot();
    assert.ok(bot);
    // Demote East mid-cut (seat freed, its card discarded), then promote a bot there.
    assert.ok(g.demoteToSpectator(g.admin.id, ids.East.id));
    assert.equal(g.players.length, 3);
    assert.ok(g.promoteSpectator(g.admin.id, bot.id, 'E'));
    assert.equal(g.players.length, 4);
    assert.ok(playerAt(g, 'E').cutCard, 'seated-during-cut newcomer gets a cut card');
    for (const p of g.players) assert.ok(p.cutCard, 'all seats hold a cut card');
    assert.doesNotThrow(() => g.determineDealer());
    assert.equal(g.state, 'bidding');
    assert.ok(['N', 'S', 'E', 'W'].includes(g.dealer.position));
    for (const p of g.players) assert.equal(p.hand.length, 4);
  });

  it('a player sat during the cut via setPosition also gets a cut card', () => {
    const { g, ids } = makeGame();
    assert.ok(g.startCut());
    const fresh = g.addPlayer('Fresh');
    g.demoteToSpectator(g.admin.id, ids.West.id);
    assert.ok(g.setPosition(fresh.id, 'W'));
    assert.ok(playerAt(g, 'W').cutCard, 'setPosition during cut deals a cut card');
    assert.doesNotThrow(() => g.determineDealer());
    assert.equal(g.state, 'bidding');
  });

  it('determineDealer is a no-op outside the cut (double-click safe)', () => {
    const { g } = makeGame();
    g.state = 'cut';
    playerAt(g, 'N').cutCard = C('♠', 'J');
    playerAt(g, 'S').cutCard = C('♠', 'A');
    playerAt(g, 'E').cutCard = C('♠', 'K');
    playerAt(g, 'W').cutCard = C('♠', 'Q');
    assert.equal(g.determineDealer(), true);
    const dealerAfterFirst = g.dealer;
    const handsAfterFirst = g.players.map(p => p.hand.length);
    assert.equal(g.state, 'bidding');
    // A second seated player clicking Determine Dealer must not re-deal or re-roll.
    assert.equal(g.determineDealer(), false);
    assert.equal(g.state, 'bidding');
    assert.equal(g.dealer, dealerAfterFirst);
    assert.deepEqual(g.players.map(p => p.hand.length), handsAfterFirst);
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
    assert.ok(!g.placeBid(playerAt(g, 'S').id, 210), 'above maximum');
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

  it('bidding below 100 ends in trump_selection with correct state', () => {
    const g = biddingGame();
    g.placeBid(playerAt(g, 'E').id, 90);
    g.placeBid(playerAt(g, 'S').id, 'pass');
    g.placeBid(playerAt(g, 'W').id, 'pass');
    g.placeBid(playerAt(g, 'N').id, 'pass');
    assert.equal(g.state, 'trump_selection');
  });

  it('bidding >= 100 ends in trump_selection with correct state', () => {
    const g = biddingGame();
    g.placeBid(playerAt(g, 'E').id, 100);
    g.placeBid(playerAt(g, 'S').id, 'pass');
    g.placeBid(playerAt(g, 'W').id, 'pass');
    g.placeBid(playerAt(g, 'N').id, 'pass');
    assert.equal(g.state, 'trump_selection');
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

describe('redeal (trump hog)', () => {
  // Declarer N holds only one heart (which becomes the reserved trump card); partner S
  // holds the remaining five hearts. Together the team holds all 6 hearts of the suit.
  function hogSetup(g) {
    g.state = 'trump_selection';
    g.dealer = playerAt(g, 'N');
    g.declarer = playerAt(g, 'N');
    g.dummy = playerAt(g, 'S');
    g.currentPlayer = g.declarer;
    setHand(g, 'N', [C('♥', 'K'), C('♠', 'J'), C('♠', '9'), C('♦', 'A'), C('♣', 'K')]);
    setHand(g, 'S', [C('♥', 'J'), C('♥', '9'), C('♥', 'A'), C('♥', '10'), C('♥', 'Q'), C('♠', 'Q')]);
  }

  it('pauses for an admin redeal when the declarer team holds all 6 trump cards', () => {
    const { g } = makeGame();
    hogSetup(g);
    assert.ok(g.selectTrump(g.declarer.id, { suit: '♥', rank: 'K' }));
    assert.equal(g.state, 'redeal_pending');
    assert.equal(g.trumpSuit, '♥');
    assert.ok(g.redealPending);
    assert.equal(g.redealPending.trumpSuit, undefined, 'trump suit stays hidden from others');
  });

  it('does not redeal when the team does not hold all the trump cards', () => {
    const { g } = makeGame();
    g.state = 'trump_selection';
    g.dealer = playerAt(g, 'N');
    g.declarer = playerAt(g, 'N');
    setHand(g, 'N', [C('♥', 'Q'), C('♠', 'J'), C('♠', '9'), C('♣', 'K')]);
    setHand(g, 'S', [C('♠', 'Q'), C('♥', '9'), C('♥', 'K'), C('♣', 'A')]);
    assert.ok(g.selectTrump(playerAt(g, 'N').id, { suit: '♥', rank: 'Q' }));
    assert.equal(g.state, 'playing');
    assert.equal(g.redealPending, null);
  });

  it('redealAdmin returns to bidding with the same dealer and clears the pending flag', () => {
    const { g } = makeGame();
    hogSetup(g);
    assert.ok(g.selectTrump(g.declarer.id, { suit: '♥', rank: 'K' }));
    assert.ok(g.redealAdmin());
    assert.equal(g.state, 'bidding');
    assert.equal(g.redealCount, 1);
    assert.equal(g.redealPending, null);
    assert.equal(g.dealer, playerAt(g, 'N'), 'dealer unchanged before the cap');
  });

  it('rotates the dealer and resets the count after 3 redeals', () => {
    const { g } = makeGame();
    g.redealCount = 3;
    g.redealPending = { reason: 'declarer team holds all trump' };
    g.state = 'redeal_pending';
    g.dealer = playerAt(g, 'N');
    assert.ok(g.redealAdmin());
    assert.equal(g.state, 'bidding');
    assert.equal(g.redealCount, 0);
    assert.equal(g.redealPending, null);
    assert.equal(g.dealer, playerAt(g, 'E'), 'dealer rotates to the next player on the 4th occurrence');
  });

  it('rejects a redeal when none is pending', () => {
    const { g } = makeGame();
    assert.ok(!g.redealAdmin());
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
    assert.equal(g.teamPoints['N-S'], 12 + 2 + 10 + 30, 'A12+Q2+10-10+J30');
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
    assert.equal(g.teamPoints['E-W'], 12 + 18 + 3 + 10);
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
    assert.equal(g.teamPoints['N-S'], 12 + 18 + 3 + 10, 'winner team tallies all cards in the trick');
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

  it('an empty-handed declarer can always play the reserved trump card (no stall)', () => {
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
    // Simulate a hand-count drift: the declarer's own cards are spent, only the
    // reserved card remains, and it is NOT the final trick.
    playerAt(g, 'N').hand = [];
    g.trickNumber = 1;
    assert.equal(g.currentPlayer, playerAt(g, 'W'), 'left of dealer S');
    assert.ok(g.playCard(playerAt(g, 'W').id, { suit: '♠', rank: 'A' }), 'West leads');
    assert.equal(g.currentPlayer, playerAt(g, 'N'), "declarer N's turn");
    assert.ok(g.playTrumpCard(playerAt(g, 'N').id), 'reserved card is playable whenever the hand is empty');
    assert.ok(g.trumpRevealed);
    assert.equal(g.trumpCard, null);
    assert.equal(g.currentTrick.length, 2);
  });

  it('a refilled declarer seat receives the still-reserved trump card after a reveal', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const decl = playerAt(g, 'N');
    assert.ok(g.trumpCard, 'reserved card exists and is not in the live hand');
    // The declarer vanishes (disconnect) and the reveal happens while the seat is
    // being moved — the rejoin cannot find a live elected seat.
    g.removePlayer(decl.id);
    assert.ok(g.vacatedHands.N, 'seat saved');
    g.trumpRevealed = true;
    assert.ok(g.trumpCard, 'reserved card still separate');
    assert.equal(g.vacatedHands.N.hand.length, 4);
    // A spectator fills the seat: the reserved card must join their restored hand.
    const spec = g.addSpectator('NewN');
    assert.equal(spec.name, 'NewN');
    g.promoteSpectator(g.admin.id, spec.id, 'N');
    assert.equal(playerAt(g, 'N'), spec);
    assert.equal(g.trumpCard, null, 'reserved card rejoined the refilled hand');
    assert.equal(playerAt(g, 'N').hand.length, 5, '4 saved cards + the rejoined reserved card');
    assert.ok(playerAt(g, 'N').hand.some(c => c.suit === '♥'), 'trump-suit card is in hand');
  });

  it('a rejoin never drops the reserved card when the declarer seat is in limbo', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    const decl = playerAt(g, 'N');
    // Hard limbo: the declarer's seat is neither a live player nor a saved seat.
    const i = g.players.indexOf(decl);
    g.players.splice(i, 1);
    delete g.positions.N;
    assert.equal(g.players.find(p => p.position === 'N'), undefined);
    assert.equal(g.vacatedHands.N, undefined);
    g.trumpRevealed = true;
    g.rejoinTrumpCard();
    assert.ok(g.trumpCard, 'reserved card is retained, never dropped');
    // Once the seat does become available again, the card must land in the hand.
    g.vacatedHands.N = { position: 'N', playerName: 'N', hand: [], team: 'N-S', wasDeclarer: true };
    const spec = g.addSpectator('NewN2');
    g.promoteSpectator(g.admin.id, spec.id, 'N');
    assert.equal(g.trumpCard, null, 'rejoin now delivers the card');
    assert.ok(playerAt(g, 'N').hand.some(c => c.suit === '♥'));
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
    g.teamPoints['N-S'] = 150;
    assert.ok(g.confirmHand(g.admin.id));
    assert.equal(g.scores['E-W'], 2);
  });

  it('a slam adds a bonus point', () => {
    const g = reviewGame(60);
    g.teamPoints['N-S'] = 300;
    assert.ok(g.confirmHand(g.admin.id));
    assert.equal(g.scores['N-S'], 3, '1 base + 2 slam');
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

describe('reset', () => {
  it('preserves the admin and clears the board by default', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    g.scores = { 'N-S': 7, 'E-W': 3 };
    g.winner = 'N-S';
    const adminId = g.admin.id;
    g.reset();
    assert.equal(g.state, 'waiting');
    assert.equal(g.admin.id, adminId, 'admin preserved by default');
    assert.equal(g.scores['N-S'], 0);
    assert.equal(g.winner, null);
    assert.equal(g.declarer, null);
    assert.equal(g.players.length, 0);
    assert.equal(g.spectators.length, 0);
    assert.deepEqual(g.vacatedHands, {}, 'vacated seats are cleared');
  });

  it('clears the admin when keepAdmin is false (Join after game over)', () => {
    const { g } = makeGame();
    setupPlaying(g, { declarer: 'N', dealer: 'N', trumpSuit: '♥', hands: DEFAULT_HANDS });
    g.state = 'game_over';
    g.winner = 'N-S';
    g.reset(false);
    assert.equal(g.state, 'waiting');
    assert.equal(g.admin, null, 'admin is not preserved');
    assert.equal(g.adminId, null);
    assert.equal(g.players.length, 0);
    assert.equal(g.spectators.length, 0);
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

describe('declarer seat vacated during trump selection (bots → humans)', () => {
  // 3 humans + a bot declarer at W in trump_selection; hands avoid the trump-hog
  // redeal so the game proceeds to playing.
  function botDeclarerTrumpGame() {
    const { g, humans, placed } = makeBotGame({ humanSeats: ['N', 'S', 'E'], botSeats: ['W'] });
    const w = placed.W;
    w.hand = [C('♠', 'A'), C('♥', 'A'), C('♠', 'Q'), C('♠', 'K')];
    playerAt(g, 'E').hand = [C('♦', 'A'), C('♦', 'K'), C('♦', 'Q'), C('♦', 'J')];
    playerAt(g, 'N').hand = [C('♥', 'J'), C('♥', 'Q'), C('♥', 'K'), C('♥', '10')];
    playerAt(g, 'S').hand = [C('♣', 'A'), C('♣', 'K'), C('♣', 'Q'), C('♣', 'J')];
    g.state = 'bidding';
    g.dealer = w;
    g.currentPlayer = w;
    g.placeBid(w.id, 50);
    g.placeBid(playerAt(g, 'N').id, 'pass');
    g.placeBid(playerAt(g, 'E').id, 'pass');
    g.placeBid(playerAt(g, 'S').id, 'pass');
    assert.equal(g.state, 'trump_selection');
    assert.equal(g.declarer, w);
    return { g, w };
  }

  it('demoting the bot declarer keeps the declarer pointing at the seat and playable', () => {
    const { g, w } = botDeclarerTrumpGame();
    g.demoteToSpectator(g.admin.id, w.id);
    assert.equal(g.state, 'trump_selection');
    // Declarer follows the vacated seat (id null) rather than a detached bot with
    // a null position, so the frontend never falls back to "Declarer is selecting trump".
    assert.equal(g.declarer.position, 'W');
    assert.equal(g.declarer.id, null);
    const saved = g.vacatedHands['W'];
    assert.ok(saved && saved.hand.some(c => c.equals(C('♠', 'A'))));
    assert.ok(g.selectVacatedTrump('W', C('♠', 'A')), 'admin can finish the trump pick');
    assert.notEqual(g.state, 'trump_selection');
  });

  it('refilling the displaced bot-declarer seat hands the trump pick to the human', () => {
    const { g, w } = botDeclarerTrumpGame();
    g.demoteToSpectator(g.admin.id, w.id);
    const human = g.addSpectator('Megan');
    assert.ok(g.promoteSpectator(g.admin.id, human.id, 'W'));
    assert.equal(g.declarer, human, 'declarer re-pointed at the refilled human');
    assert.ok(g.selectTrump(human.id, C('♠', 'A')), 'the human selects trump');
    assert.notEqual(g.state, 'trump_selection');
  });

  it('a host declarer leaving the seat stays playable via the saved seat', () => {
    const { g, w } = botDeclarerTrumpGame();
    g.demoteToSpectator(g.admin.id, w.id);
    assert.ok(g.adminSit('W'));
    assert.equal(g.declarer, g.admin, 'seated host inherits the declared seat');
    assert.ok(g.adminLeaveSeat());
    assert.equal(g.declarer.position, 'W');
    assert.equal(g.declarer.id, null);
    assert.ok(g.selectVacatedTrump('W', C('♠', 'A')));
    assert.notEqual(g.state, 'trump_selection');
  });

  it('an auction won while the seat was vacant re-points the declarer on refill', () => {
    const { g, humans, placed } = makeBotGame({ humanSeats: ['N', 'S', 'E'], botSeats: ['W'] });
    const w = placed.W;
    for (const p of g.players) p.hand = [C('♠', 'A'), C('♥', 'K'), C('♦', 'Q'), C('♣', 'J')];
    g.state = 'bidding';
    g.dealer = w;
    g.currentPlayer = w;
    // Vacate the seat mid-auction, admin wins the contract while acting for it.
    g.removePlayer(w.id);
    assert.equal(g.currentPlayer.position, 'W');
    assert.equal(g.currentPlayer.id, null);
    assert.ok(g.placeVacatedBid('W', 50), 'admin bids for the vacated seat');
    g.placeBid(playerAt(g, 'N').id, 'pass');
    g.placeBid(playerAt(g, 'E').id, 'pass');
    g.placeBid(playerAt(g, 'S').id, 'pass');
    assert.equal(g.state, 'trump_selection');
    assert.equal(g.declarer.position, 'W');
    assert.equal(g.declarer.id, null, 'declarer is the acted-for vacated seat');
    // A human refills the seat — even without the wasDeclarer flag, the declarer
    // must move to the refilled player so the trump phase can continue.
    const human = g.addSpectator('Nadia');
    assert.ok(g.promoteSpectator(g.admin.id, human.id, 'W'));
    assert.equal(g.declarer, human);
    assert.ok(g.selectTrump(human.id, C('♠', 'A')));
    assert.notEqual(g.state, 'trump_selection');
  });

  it('displacing a bot dealer mid-selection never yields a null turn', () => {
    const { g, placed } = makeBotGame({ humanSeats: ['S', 'E'], botSeats: ['N', 'W'] });
    const w = placed.W;
    const botN = placed.N;
    w.hand = [C('♥', 'A'), C('♥', 'J'), C('♠', 'A'), C('♠', '10')];
    playerAt(g, 'N').hand = [C('♠', 'K'), C('♠', 'Q'), C('♦', 'K'), C('♦', 'Q')];
    playerAt(g, 'E').hand = [C('♦', 'A'), C('♦', '10'), C('♣', 'A'), C('♣', '10')];
    playerAt(g, 'S').hand = [C('♥', 'K'), C('♥', 'Q'), C('♣', 'K'), C('♣', 'Q')];
    g.dealer = botN;
    g.state = 'bidding';
    g.currentPlayer = w;
    g.placeBid(w.id, 50);
    g.placeBid(botN.id, 'pass');
    g.placeBid(playerAt(g, 'E').id, 'pass');
    g.placeBid(playerAt(g, 'S').id, 'pass');
    assert.equal(g.state, 'trump_selection');
    // The admin displaces BOTH the bot dealer and the bot declarer mid-selection.
    g.demoteToSpectator(g.admin.id, w.id);
    g.demoteToSpectator(g.admin.id, botN.id);
    const z = g.addSpectator('Zeta');
    const y = g.addSpectator('Yana');
    assert.ok(g.promoteSpectator(g.admin.id, z.id, 'W'));
    assert.ok(g.promoteSpectator(g.admin.id, y.id, 'N'));
    assert.equal(g.declarer, z);
    assert.equal(g.dealer, y, 'dealer re-pointed at the refilled seat');
    const zHeart = z.hand.find(c => c.suit === '♥');
    assert.ok(g.selectTrump(z.id, zHeart));
    assert.equal(g.state, 'playing');
    assert.ok(g.currentPlayer && g.currentPlayer.position,
      'first lead is a real seat — no null-turn ' + 'Someone' + "'s turn" + ' hang');
  });

  it('rotation still works after the dealer seat turned over', () => {
    const { g, placed } = makeBotGame({ humanSeats: ['S', 'E'], botSeats: ['N', 'W'] });
    const botN = placed.N;
    g.dealer = botN;
    g.state = 'playing';
    g.demoteToSpectator(g.admin.id, botN.id); // dealer seat vacated -> dealer = pseudo N
    assert.equal(g.dealer.position, 'N');
    assert.equal(g.dealer.id, null);
    const y = g.addSpectator('Yana');
    assert.ok(g.promoteSpectator(g.admin.id, y.id, 'N')); // refilled -> dealer = Yana
    assert.equal(g.dealer, y);
    const before = g.dealer;
    g.resetForNextHand(true); // next hand rotates the dealer
    assert.ok(g.dealer, 'dealer survives the rotation');
    assert.notEqual(g.dealer, before, 'dealer advanced to the next seat');
    assert.ok(g.currentPlayer, 'next hand starts on a real bidder');
    assert.equal(g.state, 'bidding');
  });
});

describe('WINNING_SCORE', () => {
  it('is 12 points', () => {
    assert.equal(WINNING_SCORE, 12);
  });
});

function botAt(g, pos) {
  return g.getPlayer(g.positions[pos]);
}

// Host admin + a given mix of seated humans and bots (keyed by position).
function makeBotGame({ humanSeats = [], botSeats = [], spectatorBots = 0 }) {
  const g = new Game('bot-test');
  g.addPlayer('Host', true);
  const humans = {};
  const placed = {};
  humanSeats.forEach((pos, i) => {
    const h = g.addPlayer('Human' + i);
    humans[pos] = h;
    g.setPosition(h.id, pos);
    placed[pos] = h;
  });
  botSeats.forEach(pos => {
    const b = g.addBot();
    g.promoteSpectator(g.admin.id, b.id, pos);
    placed[pos] = b;
  });
  for (let i = 0; i < spectatorBots; i++) g.addBot();
  return { g, humans, placed };
}

describe('bots & host (computer players)', () => {
  it('addBot creates bot spectators from the name pool, capped at 3', () => {
    const g = new Game();
    g.addPlayer('Admin', true);
    const b1 = g.addBot(); const b2 = g.addBot(); const b3 = g.addBot();
    assert.ok(b1 && b1.isBot); assert.ok(b2 && b2.isBot); assert.ok(b3 && b3.isBot);
    const names = [b1.name, b2.name, b3.name];
    for (const n of names) assert.ok(BOT_NAMES.includes(n), n + ' comes from the pool');
    assert.equal(new Set(names).size, 3, 'names are unique');
    assert.equal(g.countBots(), 3);
    assert.equal(g.addBot(), null, 'no more than 3 bots total');
  });

  it('bots are exempt from the 25-viewer cap', () => {
    const g = new Game();
    g.addPlayer('Admin', true);
    for (let i = 0; i < 24; i++) g.addPlayer('P' + i);
    assert.equal(g.countViewers(), 25);
    assert.equal(g.addPlayer('Overflow'), null);
    const b = g.addBot();
    assert.ok(b, 'a bot still fits while 25 humans are seated');
    assert.equal(g.countViewers(), 25, 'bots never count toward the viewer cap');
  });

  it('bot names block human reuse', () => {
    const g = new Game();
    g.addPlayer('Admin', true);
    const bot = g.addBot();
    assert.equal(g.addPlayer(bot.name), null);
    assert.equal(g.addSpectator(bot.name.toLowerCase()), null, 'case-insensitive reuse blocked');
    g.removeBot(bot.id);
    assert.ok(g.addPlayer(bot.name), 'the name frees up when the bot is removed');
  });

  it('countBots counts seated and unseated bots together', () => {
    const { g } = makeBotGame({ humanSeats: ['N', 'S'], botSeats: ['E'], spectatorBots: 1 });
    assert.equal(g.countBots(), 2);
    assert.equal(g.players.filter(p => p.isBot).length, 1);
    assert.equal(g.spectators.filter(s => s.isBot).length, 1);
  });

  it('promoteToAdmin never promotes a bot (falls through to humans)', () => {
    const g = new Game();
    g.addPlayer('Admin', true);
    g.addBot(); g.addBot(); g.addBot();
    g.removePlayer(g.admin.id); // host leaves
    assert.equal(g.promoteToAdmin(), null, 'bots alone cannot become admin');
    // Now a human spectator joins: the human gets promoted, not the bots.
    const human = g.addSpectator('Watcher');
    const a = g.promoteToAdmin();
    assert.equal(a.id, human.id);
    assert.equal(g.countBots(), 3, 'bots stay spectators');
  });

  it('promoting a human over a seated bot mid-game preserves the seat hand and turn', () => {
    const { g } = makeBotGame({ humanSeats: ['N', 'S', 'E'], botSeats: ['W'] });
    // Declare W (the bot) with trump ♥; after trump the bot holds 3 cards.
    setupPlaying(g, { declarer: 'W', dealer: 'N', trumpSuit: '♥', bid: 60, hands: {
      W: [C('♥', 'J'), C('♠', '9'), C('♣', 'A'), C('♦', 'K')],
      N: [C('♠', 'A'), C('♠', 'Q'), C('♥', '10'), C('♦', 'J')],
      E: [C('♠', 'K'), C('♥', '9'), C('♣', 'Q'), C('♦', '10')],
      S: [C('♠', '10'), C('♥', 'A'), C('♣', 'K'), C('♦', 'Q')]
    } });
    const bot = botAt(g, 'W');
    g.currentPlayer = bot; // make the bot mid-turn — the admin replaces that seat
    const before = bot.hand.map(c => c.toString()).sort();
    const watcher = g.addSpectator('Watcher');
    const promoted = g.promoteSpectator(g.admin.id, watcher.id, 'W');
    assert.equal(promoted.id, watcher.id);
    assert.equal(watcher.position, 'W');
    assert.deepEqual(watcher.hand.map(c => c.toString()).sort(), before, 'saved hand restored');
    assert.equal(g.currentPlayer.id, watcher.id, 'the saved turn passed to the promoted human');
    assert.ok(g.spectators.includes(bot), 'bot is back in the spectator list');
    assert.equal(bot.position, null);
    assert.equal(g.vacatedHands.W, undefined, 'saved hand consumed by the promotion');
  });

  it('a human-held seat is never displaced by promotion', () => {
    const { g } = makeGame();
    const watcher = g.addSpectator('Watcher');
    // Full table: promoting onto a human-held seat is refused outright.
    assert.equal(g.promoteSpectator(g.admin.id, watcher.id, 'S'), null);
    // With a seat free, promotion onto a human-held seat still seats nobody (gallery).
    g.removePlayer(playerAt(g, 'S').id);
    const second = g.addSpectator('Viewer2');
    const p = g.promoteSpectator(g.admin.id, second.id, 'N');
    assert.equal(p.id, second.id);
    assert.equal(p.position, null, 'a seated human is never displaced');
    assert.equal(playerAt(g, 'N').name, 'North');
  });

  it('promoting a bot to a free seat seats it', () => {
    const { g } = makeBotGame({ humanSeats: ['N', 'S'], botSeats: [], spectatorBots: 1 });
    const b = g.spectators.find(s => s.isBot);
    const p = g.promoteSpectator(g.admin.id, b.id, 'E');
    assert.equal(p.position, 'E');
    assert.equal(botAt(g, 'E').isBot, true);
  });

  it('setPosition displaces a seated bot (the incoming human inherits the seat)', () => {
    const { g } = makeBotGame({ humanSeats: ['N', 'S', 'E'], botSeats: ['W'] });
    g.state = 'playing';
    const mover = botAt(g, 'E'); // E holds a human now; move them to W
    assert.ok(g.setPosition(mover.id, 'W'));
    assert.equal(g.positions.W, mover.id);
    const displaced = g.spectators.find(s => s.isBot);
    assert.ok(displaced && displaced.position === null);
    assert.equal(g.vacatedHands.W, undefined,
      'the saved seat state is transferred to the incoming human, not left vacant');
  });

  it('adminSit seats the host; adminLeaveSeat steps back off', () => {
    const { g } = makeBotGame({ humanSeats: ['S', 'E'], botSeats: ['N'], spectatorBots: 0 });
    g.removeBot(botAt(g, 'N').id); // free N so the host can sit there
    const a = g.adminSit('N');
    assert.ok(a);
    assert.equal(g.admin.position, 'N');
    assert.equal(a.team, 'N-S');
    assert.equal(g.players.includes(g.admin), true);

    const left = g.adminLeaveSeat();
    assert.equal(left.position, null);
    assert.equal(g.positions.N, undefined);
    assert.equal(g.players.includes(g.admin), false);
  });

  it('the seated host bids and plays as a normal player', () => {
    const { g } = makeBotGame({ humanSeats: ['S', 'E'], botSeats: [] });
    g.adminSit('N');
    g.state = 'bidding';
    g.currentPlayer = g.admin;
    assert.ok(g.placeBid(g.admin.id, 50), 'seated host bids via the normal path');
    assert.equal(g.highestBid, 50);

    g.state = 'playing';
    g.admin.hand = [C('♠', 'J'), C('♦', 'Q')];
    g.currentPlayer = g.admin;
    g.currentTrick = [];
    g.leadSuit = null;
    g.trickNumber = 0;
    assert.ok(g.playCard(g.admin.id, { suit: '♠', rank: 'J' }), 'seated host plays as a normal player');
    assert.equal(g.admin.playedCard.rank, 'J');
  });

  it('the host stepping off mid-game keeps their saved hand; re-sitting restores it', () => {
    const { g } = makeBotGame({ humanSeats: ['E'], botSeats: [] });
    g.adminSit('S');
    g.state = 'playing';
    g.admin.hand = [C('♥', 'J'), C('♣', 'A')];
    g.currentPlayer = g.admin;
    g.trickNumber = 0; g.currentTrick = []; g.leadSuit = null;
    g.adminLeaveSeat();                      // mid-game: hand goes to vacatedHands.S
    assert.ok(g.vacatedHands.S, 'seat saved');
    assert.equal(g.admin.position, null);
    g.adminSit('S');
    assert.deepEqual(g.admin.hand.map(c => c.toString()), ['J♥', 'A♣'], 'hand restored');
    assert.equal(g.currentPlayer.id, g.admin.id, 'the saved turn came back with it');
  });

  it('kicking a seated bot returns it to spectators and vacates the seat', () => {
    const { g } = makeBotGame({ humanSeats: ['N', 'S', 'E'], botSeats: ['W'] });
    g.state = 'playing';
    const bot = botAt(g, 'W');
    g.currentPlayer = bot;
    bot.hand = [C('♠', 'J')];
    const p = g.demoteToSpectator(g.admin.id, bot.id);
    assert.equal(p.isBot, true);
    assert.equal(g.positions.W, undefined);
    assert.ok(g.vacatedHands.W, 'seat is vacant for the admin');
    assert.equal(g.currentPlayer.id, null, 'turn became a vacated seat');
  });

  it('removeBot removes an unseated bot', () => {
    const { g } = makeBotGame({ humanSeats: ['N', 'S'], botSeats: [], spectatorBots: 1 });
    const b = g.spectators.find(s => s.isBot);
    const removed = g.removeBot(b.id);
    assert.equal(removed.id, b.id);
    assert.equal(g.countBots(), 0);
  });

  it('countViewers excludes bots and dedupes a seated host', () => {
    const g = new Game();
    g.addPlayer('Admin', true);
    for (let i = 0; i < 3; i++) g.addBot();
    g.adminSit('N');
    assert.equal(g.countViewers(), 1, 'one host counts once even while seated');
  });

  it('bots persist through toJSON/fromJSON', () => {
    const { g } = makeBotGame({ humanSeats: ['N'], botSeats: ['E'], spectatorBots: 1 });
    g.adminSit('S'); // seated host must round-trip too
    const rt = Game.fromJSON(g.toJSON());
    assert.equal(rt.admin.isBot, false);
    assert.equal(rt.admin.position, 'S');
    assert.ok(botAt(rt, 'E') && botAt(rt, 'E').isBot, 'seated bot persisted');
    assert.ok(rt.spectators.some(s => s.isBot), 'unseated bot persisted');
    assert.equal(rt.players.filter(p => p.isBot).length, 1);
    assert.equal(rt.countBots(), 2);
  });
});
