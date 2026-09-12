"use strict";
const { RANK_ORDER } = require('./gameLogic.js');

// Pure computer-player strategy. `botAction(g, bot)` inspects the game state and the
// bot's own hand and returns an action object; the server driver applies it with the
// same methods a human socket handler uses. Returns null when the bot has nothing to do.
//
//   { type: 'bid', amount }            place a numeric bid
//   { type: 'pass' }                   pass
//   { type: 'trump', card }            reserve `card` as the trump card (declarer)
//   { type: 'play', card }             play `card`
//   { type: 'play_trump' }             play the reserved trump card (declarer)
//   { type: 'ask_then_play', card }    reveal trump with Ask Trump, then play `card`

function handHcp(hand) {
  return hand.reduce((sum, c) => sum + c.hcp, 0);
}

function lowestHcp(hand) {
  return hand.slice().sort((a, b) => a.hcp - b.hcp || RANK_ORDER[a.rank] - RANK_ORDER[b.rank])[0];
}

function highestHcp(hand) {
  return hand.slice().sort((a, b) => b.hcp - a.hcp || RANK_ORDER[b.rank] - RANK_ORDER[a.rank])[0];
}

// Current best card in the trick, mirroring Game.endTrick's resolution.
function currentBest(g) {
  const trumpActive = g.trumpRevealed && !!g.trumpSuit;
  let best = null;
  for (const entry of g.currentTrick) {
    const card = entry.card;
    if (!best) { best = card; continue; }
    if (trumpActive && card.suit === g.trumpSuit && best.suit !== g.trumpSuit) best = card;
    else if (card.suit === best.suit && RANK_ORDER[card.rank] > RANK_ORDER[best.rank]) best = card;
  }
  return best;
}

function beats(card, other, g) {
  const trumpActive = g.trumpRevealed && !!g.trumpSuit;
  if (trumpActive && card.suit === g.trumpSuit && other.suit !== g.trumpSuit) return true;
  if (card.suit === other.suit && RANK_ORDER[card.rank] > RANK_ORDER[other.rank]) return true;
  return false;
}

// Pick a follow card: the lowest card that wins the trick, else the cheapest of the suit.
function followSuitChoice(g, hand, leadSuit) {
  const led = hand.filter(c => c.suit === leadSuit).sort((a, b) => a.hcp - b.hcp);
  const best = currentBest(g);
  if (best) {
    for (const c of led) {
      if (beats(c, best, g)) return c;
    }
  }
  return led[0];
}

// After revealing trump via Ask Trump, prefer to win with the cheapest trump that
// beats the current best card; otherwise dump the cheapest non-trump card.
function pickCannotFollow(g, bot) {
  const best = currentBest(g);
  const trump = g.trumpSuit;
  if (best && trump) {
    const trumps = bot.hand.filter(c => c.suit === trump).sort((a, b) => a.hcp - b.hcp);
    const bestIsTrump = best.suit === trump;
    // An opponent is winning the trick: win it with the lowest trump that beats the
    // best card (any trump beats a non-trump; a higher-rank trump beats a trump).
    for (const c of trumps) {
      if (!bestIsTrump || RANK_ORDER[c.rank] > RANK_ORDER[best.rank]) return c;
    }
  }
  // Cannot win the trick — dump the cheapest non-trump card so trumps are saved for
  // a hand that can actually win (only fall back to a trump when nothing else remains).
  const nonTrumps = trump ? bot.hand.filter(c => c.suit !== trump) : bot.hand;
  return lowestHcp(nonTrumps.length ? nonTrumps : bot.hand);
}

function decideBid(g, bot) {
  // Bidding happens with 4-card hands (2 more cards come at trump selection). A
  // neutral 4-card share is ~50 HCP (75 avg per 6-card hand). Scale the bid from
  // the player's own strength: target = 2*ownHCP - 90, floors to the next 10, bid
  // only above the minimum 50 and only when it tops the current high bid.
  const hcp = handHcp(bot.hand);
  let target = Math.floor((hcp * 2 - 90) / 10) * 10;
  if (target > 200) target = 200;
  if (target < 50) return { type: 'pass' };
  if (target <= (g.highestBid || 0)) return { type: 'pass' };
  return { type: 'bid', amount: target };
}

function decideTrump(g, bot) {
  const bySuit = {};
  for (const c of bot.hand) {
    (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
  }
  let bestSuit = null;
  let bestScore = -1;
  for (const [suit, cards] of Object.entries(bySuit)) {
    const total = cards.reduce((s, c) => s + c.hcp, 0);
    if (total > bestScore) { bestScore = total; bestSuit = suit; }
  }
  const cards = bySuit[bestSuit];
  const reserve = cards.reduce((a, b) => (a.hcp <= b.hcp ? a : b));
  return { type: 'trump', card: reserve };
}

// True when the card currently winning the trick was played by the bot's partner
// (any player on the same team — including a vacated seat). The bot itself cannot
// be in the trick yet as it is the current player.
function partnerWinning(g, bot) {
  if (!g.currentTrick.length) return false;
  const best = currentBest(g);
  const entry = g.currentTrick.find(e => e.card === best);
  return !!(entry && entry.player && entry.player.team &&
            entry.player.team === bot.team && entry.player.id !== bot.id);
}

function decidePlay(g, bot) {
  const hand = bot.hand;
  const leading = g.currentTrick.length === 0;
  const leadSuit = g.leadSuit;
  const hasLeadSuit = !!leadSuit && hand.some(c => c.suit === leadSuit);
  const isDeclarer = g.declarer && g.declarer.id === bot.id;
  const canPlayTrump = isDeclarer && g.trumpCard && !g.trumpCardPlayed;

  // When a partner is already winning the trick, do not fight for it: follow with the
  // highest led-suit card, or the strongest card of another suit. Never burn a trump
  // (the reserved trump or a trump-suit card) unless that is all that is left in hand.
  if (!leading && partnerWinning(g, bot)) {
    if (hasLeadSuit) return { type: 'play', card: highestHcp(hand.filter(c => c.suit === leadSuit)) };
    const others = hand.filter(c => c.suit !== g.trumpSuit);
    if (others.length) return { type: 'play', card: highestHcp(others) };
    if (hand.length) return { type: 'play', card: highestHcp(hand) };
    if (canPlayTrump) return { type: 'play_trump' }; // the reserved trump is the only card
    return null;
  }

  // Declarer: the reserved trump card wins on the last trick, or any trick where the
  // led suit can't be followed.
  if (canPlayTrump && (g.trickNumber >= 5 || (!leading && !hasLeadSuit))) {
    return { type: 'play_trump' };
  }

  // Defender/partner can't follow and trump is hidden: reveal it, then play.
  if (!isDeclarer && !g.trumpRevealed && !leading && !hasLeadSuit) {
    return { type: 'ask_then_play', card: pickCannotFollow(g, bot) };
  }

  if (leading) return { type: 'play', card: highestHcp(hand) };
  if (hasLeadSuit) return { type: 'play', card: followSuitChoice(g, hand, leadSuit) };
  // Cannot follow the led suit (trump already revealed): overtrump the opponent's
  // winning card when possible, otherwise dump the cheapest non-trump card.
  return { type: 'play', card: pickCannotFollow(g, bot) };
}

function botAction(g, bot) {
  if (!g || !bot || !bot.isBot) return null;
  if (g.state === 'bidding' && g.currentPlayer && g.currentPlayer.id === bot.id) return decideBid(g, bot);
  if (g.state === 'trump_selection' && g.declarer && g.declarer.id === bot.id) return decideTrump(g, bot);
  if (g.state === 'playing' && g.currentPlayer && g.currentPlayer.id === bot.id) return decidePlay(g, bot);
  return null;
}

module.exports = { botAction, decideBid, decideTrump, decidePlay, handHcp };