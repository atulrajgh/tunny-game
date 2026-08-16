"use strict";

// Static HTML for the /instructions page. Kept out of server.js so the server
// logic stays focused on routing/sockets; this file is pure content.
function renderInstructions(version) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tunny — Rules</title><style>
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

<h3>4. Trump Selection</h3>
<p>The declarer selects one card from their hand. That card's suit becomes <strong>trump</strong>. The selected card is set aside from the declarer's hand and is visible only to the declarer until it is played or the trump is revealed. The remaining deck is then dealt out.</p>

<h3>5. Play</h3>
<p>Players play tricks clockwise, following the lead suit whenever possible. If you cannot follow suit, you may play any card, including a trump. The highest card of the lead suit wins the trick unless a trump is played — then the highest trump wins. Each player plays their own hand; the declarer's partner is an independent player like anyone else.</p>
<p><strong>Trump visibility:</strong> The trump suit is hidden from everyone (players and admin) until it is revealed. The admin sees the trump only when it is revealed or when the admin is acting as the declarer.</p>
<ul>
<li><strong>Ask Trump</strong> — any non-declarer player (the declarer's partner or a defender) may reveal the trump on their turn when they cannot follow the led suit. The reserved trump card then rejoins the declarer's hand as a normal card.</li>
<li><strong>Play Trump</strong> — the declarer may play the reserved trump card to reveal the trump, but only when following a led suit while holding no card of that suit (never while leading), except on the <strong>final trick of a hand</strong>, where it is always available.</li>
</ul>
<p>Until the trump is revealed, trump-suit cards count as ordinary cards and cannot beat the led suit; once revealed, the highest trump in a trick wins.</p>

<h3>6. Scoring</h3>
<p>When all tricks are done, the admin reviews the hand and confirms it. The outcome is decided by <strong>HCP</strong>, not the trick count.</p>
<ul>
<li>If the declarer's team makes the contract, they earn <strong>2 points</strong> when the winning bid is <strong>≥ 100</strong>, otherwise <strong>1 point</strong>.</li>
<li>If the declarer's team fails, the defending team earns <strong>double the bid's points</strong> (4 points for a bid ≥ 100, 2 otherwise).</li>
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
<li><strong>Game State</strong> — hand/trick, state, declarer, bid, trump</li>
<li><strong>Bids</strong> — each player's bid</li>
<li><strong>Current Trick</strong> — cards played</li>
<li><strong>Scores</strong> — running scores, HCP, tricks</li>
<li><strong>Controls</strong> — Move Dealer, Reset Scores, Reset Game, Take Over, Confirm & Next Hand</li>
</ul>

<div class="back"><a href="/">← Back to Game</a></div>
<div class="version">Version ${version}</div>
</body></html>`;
}

module.exports = { renderInstructions };
