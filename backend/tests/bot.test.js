"use strict";
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Game, Player, Card } = require('../src/gameLogic.js');
const { botAction, decideBid, decideTrump, decidePlay, handHcp } = require('../src/bot.js');

const C = (suit, rank) => new Card(suit, rank);

// A fresh game with a host admin and a single (unseated) bot spectator.
function mkGame() {
  const g = new Game('strategy-test');
  g.addPlayer('Host', true);
  const bot = g.addBot();
  return { g, bot };
}

function calcHcp(cards) {
  return cards.reduce((s, c) => s + ({ J: 30, 9: 18, A: 12, 10: 10, K: 3, Q: 2 }[c.rank]), 0);
}

describe('bot strategy', () => {
  it('handHcp sums the standard HCP table', () => {
    const cards = [C('♥', 'J'), C('♠', '9'), C('♦', 'A'), C('♣', '10'), C('♥', 'K'), C('♠', 'Q')];
    assert.equal(handHcp(cards), calcHcp(cards));
  });

  it('bids on a strong 4-card hand, passes on a weak one, respects the high bid', () => {
    const { g, bot } = mkGame();
    // 30+18+12+10 = 70 HCP -> target floor((140-90)/10)*10 = 50.
    bot.hand = [C('♥', 'J'), C('♠', '9'), C('♦', 'A'), C('♣', '10')];
    assert.deepEqual(decideBid(g, bot), { type: 'bid', amount: 50 });

    g.highestBid = 50;
    assert.deepEqual(decideBid(g, bot), { type: 'pass' }, 'bid must exceed the high bid');

    bot.hand = [C('♥', 'A'), C('♠', '10'), C('♦', 'K'), C('♣', 'Q')]; // 27 HCP -> target 0
    g.highestBid = null;
    assert.deepEqual(decideBid(g, bot), { type: 'pass' }, 'weak hand passes');

    bot.hand = [C('♥', 'J'), C('♠', '9'), C('♦', 'A'), C('♣', '10')];
    g.highestBid = 90;
    assert.deepEqual(decideBid(g, bot), { type: 'pass' }, 'already well covered');
  });

  it('selects the highest-HCP suit and reserves its weakest card', () => {
    const { g, bot } = mkGame();
    bot.hand = [C('♥', 'J'), C('♥', 'Q'), C('♠', '9'), C('♠', 'K'), C('♠', '10'), C('♦', 'A')];
    const d = decideTrump(g, bot);
    assert.equal(d.type, 'trump');
    assert.equal(d.card.suit, '♥');
    assert.equal(d.card.rank, 'Q');
  });

  it('leads with its strongest card', () => {
    const { g, bot } = mkGame();
    g.state = 'playing';
    g.currentTrick = [];
    g.leadSuit = null;
    g.trumpRevealed = false; g.trumpSuit = '♥';
    g.trickNumber = 0;
    bot.hand = [C('♠', 'Q'), C('♦', 'J'), C('♣', 'K')];
    const d = decidePlay(g, bot);
    assert.equal(d.type, 'play');
    assert.equal(d.card.toString(), 'J♦');
  });

  it('follows suit with the lowest winning card', () => {
    const { g, bot } = mkGame();
    g.state = 'playing';
    g.trumpRevealed = false; g.trumpSuit = '♥';
    g.trickNumber = 2;
    g.declarer = { id: 'someone-else' };
    g.currentTrick = [{ player: { id: 'p', team: 'E-W' }, card: C('♠', 'A') }];
    g.leadSuit = '♠';
    bot.hand = [C('♠', '9'), C('♦', 'Q')];
    const d = decidePlay(g, bot);
    assert.equal(d.type, 'play');
    assert.equal(d.card.toString(), '9♠', 'lowest card that wins the trick');
  });

  it('dumps its cheapest led-suit card when it cannot win', () => {
    const { g, bot } = mkGame();
    g.state = 'playing';
    g.trumpRevealed = false; g.trumpSuit = '♥';
    g.trickNumber = 2;
    g.declarer = { id: 'someone-else' };
    g.currentTrick = [{ player: { id: 'p', team: 'E-W' }, card: C('♠', 'A') }];
    g.leadSuit = '♠';
    bot.hand = [C('♠', 'Q'), C('♦', 'Q')];
    const d = decidePlay(g, bot);
    assert.equal(d.type, 'play');
    assert.equal(d.card.toString(), 'Q♠');
  });

  it('a defender who cannot follow asks to reveal the hidden trump, then plays', () => {
    const { g, bot } = mkGame();
    g.state = 'playing';
    g.trumpRevealed = false; g.trumpSuit = '♥';
    g.trickNumber = 0;
    g.declarer = { id: 'someone-else' };
    g.currentTrick = [{ player: { id: 'p', team: 'E-W' }, card: C('♠', 'A') }];
    g.leadSuit = '♠';
    bot.hand = [C('♥', 'J'), C('♦', '10')]; // no spade; ♥J is the hidden trump
    const d = decidePlay(g, bot);
    assert.equal(d.type, 'ask_then_play');
    assert.equal(d.card.toString(), 'J♥');
  });

  it('the declarer plays the reserved trump when they cannot follow', () => {
    const { g, bot } = mkGame();
    g.state = 'playing';
    g.trickNumber = 0;
    g.declarer = bot;
    g.trumpSuit = '♥';
    g.trumpRevealed = false;
    g.trumpCard = C('♥', 'A');
    g.trumpCardPlayed = false;
    g.currentTrick = [{ player: { id: 'p', team: 'E-W' }, card: C('♠', 'A') }];
    g.leadSuit = '♠';
    bot.hand = [C('♥', 'J'), C('♦', '10')];
    const d = decidePlay(g, bot);
    assert.equal(d.type, 'play_trump');
  });

  it('dumps the cheapest card once the trump is already revealed', () => {
    const { g, bot } = mkGame();
    g.state = 'playing';
    g.trumpRevealed = true; g.trumpSuit = '♥';
    g.trickNumber = 2;
    g.declarer = { id: 'someone-else' };
    g.currentTrick = [{ player: { id: 'p', team: 'E-W' }, card: C('♠', 'A') }];
    g.leadSuit = '♠';
    bot.hand = [C('♥', 'J'), C('♦', '10')];
    const d = decidePlay(g, bot);
    assert.equal(d.type, 'play');
    assert.equal(d.card.toString(), '10♦', 'no trump play needed when trump is public');
  });

  it('botAction dispatches on the game state and the bot turn', () => {
    const { g, bot } = mkGame();
    g.state = 'bidding';
    g.currentPlayer = bot;
    bot.hand = [C('♥', 'J'), C('♠', '9'), C('♦', 'A'), C('♣', '10')];
    assert.deepEqual(botAction(g, bot), { type: 'bid', amount: 50 });

    g.state = 'trump_selection';
    g.declarer = bot;
    bot.hand = [C('♥', 'J'), C('♥', 'Q'), C('♠', '9'), C('♠', 'K'), C('♠', '10'), C('♦', 'A')];
    assert.equal(botAction(g, bot).type, 'trump');

    g.state = 'playing';
    g.trumpRevealed = false; g.trumpSuit = '♥';
    g.declarer = { id: 'someone-else' };
    g.currentTrick = [{ player: { id: 'p', team: 'E-W' }, card: C('♠', 'A') }];
    g.leadSuit = '♠';
    bot.hand = [C('♥', 'J'), C('♦', '10')];
    assert.equal(botAction(g, bot).type, 'ask_then_play');

    bot.hand = [C('♠', 'J'), C('♦', '10')];
    assert.equal(botAction(g, bot).type, 'play', 'has a spade, follows normally');
  });

  it('never acts for a human or an off-turn bot', () => {
    const { g, bot } = mkGame();
    const human = g.players[0]; // Host
    g.state = 'playing';
    g.currentPlayer = human;
    assert.equal(botAction(g, human), null, 'a human has no bot action');
    assert.equal(botAction(g, bot), null, 'a bot off-turn has no bot action');
  });
});

describe('full hand driven by bots', () => {
  // Mirrors the server bot driver (runBotTurn) against pure game logic.
  function runBotStep(g) {
    if (g.state === 'redeal_pending') return g.redealAdmin();
    if (g.state === 'hand_review' || g.state === 'game_over') return true;
    const cp = g.currentPlayer;
    if (!cp) return false;
    const bot = g.getPlayer(cp.id);
    if (!bot || !bot.isBot) return false;
    const action = botAction(g, bot);
    if (!action) return false;
    if (action.type === 'bid') return g.placeBid(bot.id, action.amount);
    if (action.type === 'pass') return g.placeBid(bot.id, 'pass');
    if (action.type === 'trump') return g.selectTrump(bot.id, action.card);
    if (action.type === 'play') return g.playCard(bot.id, action.card);
    if (action.type === 'play_trump') return g.playTrumpCard(bot.id);
    if (action.type === 'ask_then_play') {
      const asked = g.askTrump(bot.id);
      return g.playCard(bot.id, action.card) || asked;
    }
    return false;
  }

  it('4 bots drive bidding -> trump -> 6 tricks -> hand review', () => {
    const g = new Game('bot-hand');
    g.addPlayer('Host', true);
    const bots = [];
    for (let i = 0; i < 4; i++) {
      const b = new Player('bot-' + i, 'Bot ' + (i + 1));
      b.isBot = true;
      g.players.push(b);
      bots.push(b);
    }
    // Seat all four bots directly (the addBot cap applies only to live joins).
    for (const [i, pos] of ['N', 'S', 'E', 'W'].entries()) {
      const b = bots[i];
      g.positions[pos] = b.id;
      b.position = pos;
      b.team = pos === 'N' || pos === 'S' ? 'N-S' : 'E-W';
    }
    g.setupDeck();
    g.state = 'cut';
    g.dealer = bots[0];
    for (const b of g.players) b.cutCard = g.deck.pop();
    g.determineDealer();
    assert.equal(g.state, 'bidding');

    let guard = 0;
    while (!['hand_review', 'game_over'].includes(g.state) && guard < 500) {
      guard++;
      const ok = runBotStep(g);
      // Every action is legal; if the loop stalls, we want the failure loud.
      assert.ok(ok, 'bot step failed at ' + g.state);
    }
    assert.equal(g.state, 'hand_review', 'stalled after ' + guard + ' steps');
    assert.equal(g.handNumber, 1);
    assert.equal(g.trickHistory.length, 6);
    // The declarer's contract was decided by HCP, so a score must have been tallied.
    assert.notDeepEqual(g.teamPoints, { 'N-S': 0, 'E-W': 0 });
  });
});