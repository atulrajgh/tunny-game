import React from 'react';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['J', '9', 'A', '10', 'K', 'Q'];
const POSITIONS = ['N', 'E', 'S', 'W'];
const DEMO_HAND = [['♠', 'J'], ['♠', '9'], ['♠', 'A'], ['♥', 'A'], ['♥', '10'], ['♦', 'K']];

function card(suit, rank) {
  return { suit, rank, toString: () => rank + suit };
}

function renderCard(c, small) {
  return pc(c, { sm: small });
}

function renderMiniCard(c) {
  if (!c) return null;
  const isRed = c.suit === '♥' || c.suit === '♦';
  return <span className={`mini-card${isRed ? ' red' : ''}`}>{c.rank}<span className="suit-mark">{c.suit}</span></span>;
}

function pc(c, opts = {}) {
  if (!c) return null;
  const isRed = c.suit === '♥' || c.suit === '♦';
  return (
    <span className={`pc${opts.sm ? ' sm' : ''}${isRed ? ' red' : ''}`}>
      <span className="ix tl">{c.rank}</span>
      <span className="ix br">{c.rank}</span>
      <span className="cpip">{c.suit}</span>
    </span>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 48, padding: 24, background: '#1e3a1e', borderRadius: 12 }}>
      <h2 style={{ fontSize: 24, marginBottom: 16, color: '#f0c040' }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 16, marginBottom: 12, color: '#a0d0a0' }}>{title}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>{children}</div>
    </div>
  );
}

export default function UIViewer() {
  const [version, setVersion] = React.useState('');

  React.useEffect(() => {
    fetch('/settings.json')
      .then(r => r.json())
      .then(s => { if (s && s.version) setVersion(s.version); })
      .catch(() => {});
  }, []);

  return (
    <div className="app" style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 36, marginBottom: 24, textAlign: 'center' }}>Tunny UI Viewer</h1>
      <p style={{ textAlign: 'center', marginBottom: 32, color: '#a0d0a0' }}>
        Use this page to preview components in isolation. Navigate back to the app with the browser back button or by changing the URL.
      </p>

      <Section title="Cards">
        <Row title="All suits (full size)">
          {SUITS.map(s => <span key={s}>{renderCard(card(s, 'A'))}</span>)}
        </Row>
        <Row title="All ranks (spades)">
          {RANKS.map(r => <span key={r}>{renderCard(card('♠', r))}</span>)}
        </Row>
        <Row title="Red suits">
          {['♥', '♦'].map(s => <span key={s}>{renderCard(card(s, 'J'))}</span>)}
        </Row>
        <Row title="Small cards">
          {SUITS.map(s => <span key={s}>{renderCard(card(s, '10'), true)}</span>)}
        </Row>
        <Row title="Card back">
          <span className="card-back" />
          <span className="card-back mini" />
        </Row>
        <Row title="Reserved trump (face-down slot)">
          <div className="trump-reserved">
            {renderCard(card('♥', '9'))}
            <span className="trump-reserved-label">TRUMP</span>
          </div>
        </Row>
      </Section>

      <Section title="Mini cards">
        <Row title="Review / admin mini cards">
          {SUITS.map(s => <span key={s}>{renderMiniCard(card(s, 'K'))}</span>)}
        </Row>
        <Row title="Mini card winner">
          <span className="mini-card trick-winner">J<span className="suit-mark">♠</span></span>
        </Row>
      </Section>

      <Section title="Buttons">
        <Row title="Action buttons">
          <button className="action-btn">Ask Trump</button>
          <button className="action-btn">Play Trump</button>
          <button className="action-btn reset">Reset</button>
        </Row>
        <Row title="Bid controls">
          <button className="bid-pass">Pass</button>
          <button className="bid-inc">70</button>
          <div className="bid-stepper">
            <button className="bid-arrow">▲</button>
            <div className="bid-hcp">80</div>
            <button className="bid-arrow">▼</button>
          </div>
        </Row>
        <Row title="Admin controls">
          <button className="ac-btn blue">Assign</button>
          <button className="ac-btn green">Promote</button>
          <button className="ac-btn orange">Swap</button>
          <button className="ac-btn red">Kick</button>
          <button className="ac-btn gray">Reset</button>
          <button className="ac-btn pos">N</button>
        </Row>
        <Row title="Other buttons">
          <button className="start-btn">Start Game</button>
          <button className="mini-btn">Assign</button>
          <button className="mini-btn kick">Kick</button>
        </Row>
      </Section>

      <Section title="Overlays">
        <Row title="Bidding overlay (top-left style)">
          <div className="overlay bidding-top active" style={{ position: 'relative', transform: 'none', left: 0, top: 0 }}>
            <h3>Bidding</h3>
            <div className="bid-buttons">
              <button className="bid-pass">Pass</button>
              <div className="bid-stepper">
                <button className="bid-arrow">▲</button>
                <div className="bid-hcp">60</div>
                <button className="bid-arrow">▼</button>
              </div>
              <button className="bid-inc">60</button>
            </div>
          </div>
        </Row>
        <Row title="Bidding overlay (disabled — not your turn)">
          <div className="overlay bidding-top active" style={{ position: 'relative', transform: 'none', left: 0, top: 0 }}>
            <h3>Bidding</h3>
            <div className="bid-buttons">
              <button className="bid-pass" disabled>Pass</button>
              <div className="bid-stepper">
                <button className="bid-arrow" disabled>▲</button>
                <div className="bid-hcp">70</div>
                <button className="bid-arrow" disabled>▼</button>
              </div>
              <button className="bid-inc" disabled>70</button>
            </div>
          </div>
        </Row>
        <Row title="Trump selection overlay">
          <div className="overlay active" style={{ position: 'relative', transform: 'none', left: 0, top: 0 }}>
            <h3>Choose trump</h3>
            <div className="trump-cards">
              {RANKS.slice(0, 4).map((r, i) => (
                <button key={i} className="card-btn">{renderCard(card('♥', r))}</button>
              ))}
            </div>
          </div>
        </Row>
      </Section>

      <Section title="Game table elements">
        <Row title="Table seats">
          {POSITIONS.map(pos => (
            <div key={pos} className="table-seat" style={{ background: '#1a3a1a', borderRadius: 8, padding: 16 }}>
              <div className="seat-info">
                Player {pos}<span className="team-badge">NS</span>
              </div>
              <span className="card-back" />
              <span className="tricks">2 tricks</span>
            </div>
          ))}
        </Row>
        <Row title="Current trick">
          <div className="current-trick">
            {POSITIONS.map(pos => (
              <div key={pos} className="trick-entry">
                {renderCard(card('♠', 'J'))}
                <span>{pos}</span>
              </div>
            ))}
          </div>
        </Row>
        <Row title="Team scores">
          <div className="team-scores">
            <div className="ts-row header"><span></span><span>Score</span><span>HCP</span></div>
            <div className="ts-row ns"><span>NS</span><span>4</span><span>220</span></div>
            <div className="ts-row ew"><span>EW</span><span>2</span><span>120</span></div>
          </div>
        </Row>
        <Row title="State bar">
          <div className="state-bar" style={{ flex: 1 }}>
            <div className="state-info">
              <div className="round-info">Hand 3 • Trick 2</div>
            </div>
            <div className="trump-indicator"><span className="trump-revealed">♥ Trump</span></div>
          </div>
        </Row>
      </Section>

      <Section title="New cross table layout (proposed)">
        <div className="table-cross">
          <div className="tc-score">
            <div className="team-scores">
              <div className="ts-row header"><span></span><span>Score</span><span>HCP</span></div>
              <div className="ts-row ns"><span>N-S</span><span>4</span><span>220</span></div>
              <div className="ts-row ew"><span>E-W</span><span>2</span><span>120</span></div>
              <a href="/instructions" target="_blank" className="help-link">How to Play</a>
            </div>
          </div>

          <div className="tc-north">
            <div className="dummy-card">
              <span className="dummy-name">Bob</span>
              <span className="dummy-role">Partner</span>
              <span className="dummy-count">5</span>
            </div>
          </div>

          <div className="tc-controls">
            <button className="ac-menu-btn">Controls <span aria-hidden="true">▾</span></button>
          </div>

          <div className="tc-west">
            <div className="dummy-card">
              <span className="dummy-name">Carol</span>
              <span className="dummy-count">5</span>
            </div>
          </div>

          <div className="tc-table">
            <div className="seat-block">
              <div className="seat-plate"><span className="seat-name">Bob</span><span className="seat-meta">Partner · 5</span></div>
            </div>
            <div className="tc-trick">
              <div className="tk tk-n"><span>Bob</span>{renderCard(card('♥', 'A'))}</div>
              <div className="tk tk-w"><span>Carol</span>{renderCard(card('♠', '10'))}</div>
              <div className="tk tk-e"><span>Dan</span>{renderCard(card('♥', 'J'))}</div>
              <div className="tk tk-s"><span>You</span>{renderCard(card('♠', 'K'))}<span className="trick-leader" title="Started the trick">1</span></div>
            </div>
          </div>

          <div className="tc-west">
            <div className="seat-block">
              <div className="seat-plate"><span className="seat-name">Carol</span><span className="seat-meta">Defender · 5</span></div>
            </div>
          </div>
          <div className="tc-east">
            <div className="seat-block">
              <div className="seat-plate"><span className="seat-name">Dan</span><span className="seat-meta">Defender · 5</span></div>
            </div>
          </div>

          <div className="tc-south">
            <div className="message-bar">
              <span className="current-action-msg">Bob is playing</span>
            </div>
            <div className="my-hand hand-row">
              {[['♠', 'J'], ['♥', '9'], ['♦', 'A'], ['♣', '10'], ['♠', 'K'], ['♥', 'A']].map(([s, r], i) => (
                <button key={i} className="hand-card">{renderCard(card(s, r))}</button>
              ))}
            </div>
            <div className="seat-block">
              <div className="seat-plate"><span className="seat-name">You</span><span className="seat-meta">You · 6</span></div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="New playing cards (proposed)">
        <Row title="Card faces — every rank (spades) + red suits">
          {RANKS.map(r => <span key={r}>{pc(card('♠', r))}</span>)}
          {['♥', '♦'].map(s => <span key={s}>{pc(card(s, '10'))}</span>)}
        </Row>
        <Row title="Small size (trick / cut)">
          {SUITS.map(s => <span key={s}>{pc(card(s, 'A'), { sm: true })}</span>)}
        </Row>
        <Row title="Your hand — sorted row (individual cards)">
          <div className="hand-row">
            {DEMO_HAND.map(([s, r], i) => (
              <span key={i} className="hand-card">
                {pc(card(s, r))}
              </span>
            ))}
          </div>
        </Row>
        <Row title="Current trick — compass (N / E / S / W)">
          <div className="tc-trick" style={{ margin: '0 auto' }}>
            <div className="tk tk-n"><span>Bob</span>{pc(card('♥', 'A'), { sm: true })}</div>
            <div className="tk tk-w"><span>Carol</span>{pc(card('♠', '10'), { sm: true })}</div>
            <div className="tk tk-e"><span>Dan</span><span className="pc-back sm" /></div>
            <div className="tk tk-s"><span>You</span>{pc(card('♠', 'K'), { sm: true })}<span className="trick-leader" title="Started the trick">1</span></div>
          </div>
        </Row>
        <Row title="Card back + opponent seat plate">
          <span className="pc-back" />
          <span className="pc-back sm" />
          <div className="seat-block">
            <div className="seat-plate">
              <span className="seat-name">Carol</span>
              <span className="seat-meta">Defender · 5</span>
            </div>
          </div>
        </Row>
      </Section>

      <Section title="Notifications">
        <Row title="Message bar">
          <div className="message-bar">
            <span className="current-action-msg">Alice is bidding</span>
            <span className="your-turn-msg">Your turn!</span>
          </div>
        </Row>
        <Row title="Message bar (waiting - seats open, admin)">
          <div className="message-bar">
            <span className="flow-msg">
              <button className="action-btn">Assign Seats</button>
              <span className="flow-hint"> — or seat players/bots from the People list</span>
            </span>
          </div>
        </Row>
        <Row title="Message bar (waiting - observer / non-admin)">
          <div className="message-bar">
            <span className="flow-msg">
              <button className="action-btn" disabled>Assign Seats</button>
              <span className="flow-hint"> (admin only)</span>
              <span className="flow-hint"> — or seat players/bots from the People list</span>
            </span>
          </div>
        </Row>
        <Row title="Message bar (waiting - full table)">
          <div className="message-bar">
            <span className="flow-msg">
              <button className="action-btn">Determine Dealer</button>
            </span>
          </div>
        </Row>
        <Row title="Message bar (admin)">
          <div className="message-bar">
            <span className="redeal-msg">Reduced trump: N-S holds 6 trumps<span className="redeal-count"> (2 redeals so far)</span><button>Redeal</button></span>
          </div>
        </Row>
        <Row title="Message bar (error)">
          <div className="message-bar error">
            <span>Invalid play — you must follow the led suit</span>
          </div>
        </Row>
      </Section>

      <Section title="Hand review screen">
        <div className="review-screen" style={{ textAlign: 'center' }}>
          <h2 className="review-title">Hand 4 Review · Highest Bid: 100 (235 HCP)</h2>
          <div className="ac-trick-table review-table" style={{ margin: '16px auto', maxWidth: 760 }}>
            <div className="ac-trick-table-header">
              <span className="ac-tt-trick">Trick</span>
              <span className="ac-tt-pts">Team Totals</span>
              <span className="ac-tt-card">Alice<span className="trump-suit">♥</span></span>
              <span className="ac-tt-card">Bob</span>
              <span className="ac-tt-card">Carol</span>
              <span className="ac-tt-card">Dan</span>
            </div>
            {[
              { cards: [card('♥', 'A'), card('♠', '10'), card('♥', 'J'), card('♠', 'K')], winner: 'N-S', winnerPosition: 'N', ns: 20, ew: 0 },
              { cards: [card('♣', 'Q'), card('♦', '9'), card('♣', 'K'), card('♠', 'J')], winner: 'E-W', winnerPosition: 'E', ns: 20, ew: 15 },
              { cards: [card('♠', 'A'), card('♥', 'K'), card('♦', 'J'), card('♠', 'Q')], winner: 'N-S', winnerPosition: 'S', ns: 50, ew: 15 },
              { cards: [card('♣', 'J'), card('♦', '10'), card('♥', 'Q'), card('♦', 'K')], winner: 'E-W', winnerPosition: 'W', ns: 50, ew: 65 },
              { cards: [card('♠', '9'), card('♣', '10'), card('♦', 'A'), card('♥', '10')], winner: 'N-S', winnerPosition: 'N', ns: 95, ew: 65 },
              { cards: [card('♣', 'A'), card('♦', 'Q'), card('♣', '9'), card('♠', '10')], winner: 'E-W', winnerPosition: 'E', ns: 95, ew: 105 }
            ].map((t, i) => (
              <div key={i} className={`ac-trick-table-row${t.winner === 'N-S' ? ' win-ns' : ' win-ew'}`}>
                <span className="ac-tt-trick">{i + 1}</span>
                <span className="ac-tt-pts team-totals">
                  <span className="team-total">{t.winner === 'N-S' ? `+${t.ns}` : `+${t.ew}`}</span>
                </span>
                {['N', 'S', 'E', 'W'].map(pos => {
                  const c = t.cards[i % 4];
                  const isWinner = t.winnerPosition === pos;
                  return (
                    <span key={pos} className="ac-tt-card">
                      <span className={`mini-card${isWinner ? ' trick-winner' : ''} ${c.suit === '♥' || c.suit === '♦' ? 'red' : ''}`}>{c.rank}<span className="suit-mark">{c.suit}</span></span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <button className="start-btn">Confirm & Next Hand</button>
          <div className="credit">This site is brought to you courtesy of <a href="https://render.com/" target="_blank" rel="noreferrer">https://render.com/</a></div>
          <div className="version">Version {version || '…'}</div>
        </div>
      </Section>

      <Section title="Game over screen">
        <div className="app gameover-screen" style={{ background: 'transparent', padding: 0 }}>
          <h2>Game Over</h2>
          <div className="winner-banner">North & South Win</div>
          <div className="final-scores">
            <div className="score-card">
              <h3>N-S</h3>
              <div className="score-num">12</div>
              <div>Alice<span className="trump-suit">♥</span></div>
              <div>Bob</div>
            </div>
            <div className="score-card">
              <h3>E-W</h3>
              <div className="score-num">5</div>
              <div>Carol</div>
              <div>Dan</div>
            </div>
          </div>
          <a href="/instructions" target="_blank" className="help-link" style={{ marginTop: 16 }}>How to Play</a>
          <div className="login-box" style={{ margin: '16px auto 0' }}>
            <input placeholder="Your Name" defaultValue="" />
            <button>Join</button>
          </div>
          <div className="credit">This site is brought to you courtesy of <a href="https://render.com/" target="_blank" rel="noreferrer">https://render.com/</a></div>
          <div className="version">Version {version || '…'}</div>
        </div>
      </Section>

      <Section title="Bots & Host">
        <Row title="Badges">
          <span>Alice<span className="bot-tag">BOT</span></span>
          <span>Bob<span className="host-tag">HOST</span></span>
          <span className="offline-tag">reconnecting</span>
        </Row>
        <Row title="Host seat controls">
          <div className="ac-player-row" style={{ maxWidth: 420 }}>
            <span className="ac-name">You <span className="host-tag">HOST</span></span>
            <span className="ac-team">—</span>
            <span className="ac-actions">
              <button className="ac-btn green pos">N</button>
              <button className="ac-btn green pos">S</button>
              <button className="ac-btn gray pos">E</button>
              <button className="ac-btn gray pos">W</button>
            </span>
          </div>
        </Row>
        <Row title="Bot controls">
          <div className="ac-player-row" style={{ maxWidth: 420 }}>
            <span className="ac-name">Alex<span className="bot-tag">BOT</span></span>
            <span className="ac-team">Unseated</span>
            <span className="ac-actions">
              <button className="ac-btn green pos">N</button>
              <button className="ac-btn green pos">S</button>
            </span>
          </div>
          <div className="ac-player-row" style={{ maxWidth: 420 }}>
            <span className="ac-name">Abbot<span className="bot-tag">BOT</span></span>
            <span className="ac-team">@E</span>
            <span className="ac-actions">
              <button className="ac-btn red pos">✕</button>
            </span>
          </div>
        </Row>
      </Section>

      <Section title="Admin panel preview">
        <div className="admin-panel">
          <div className="ac-header">
            <h2>Admin Panel</h2>
            <button className="ac-toggle">Hide</button>
          </div>
          <div className="ac-grid">
            <div className="ac-panel">
              <h3>People</h3>
              <div style={{ fontSize: 11, color: '#a0d0a0', marginBottom: 6 }}>Host</div>
              <div className="ac-player-row">
                <span className="ac-name">You <span className="host-tag">HOST</span></span>
                <span className="ac-team">—</span>
                <div className="ac-actions">
                  <button className="ac-btn green pos">S</button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#a0d0a0', margin: '10px 0 6px 0' }}>Bots</div>
              <div className="ac-player-row">
                <span className="ac-name">Abbot<span className="bot-tag">BOT</span></span>
                <span className="ac-team">@E</span>
                <div className="ac-actions"><button className="ac-btn red pos">✕</button></div>
              </div>
              <div className="ac-player-row">
                <span className="ac-name">Bianca<span className="bot-tag">BOT</span></span>
                <span className="ac-team">Unseated</span>
                <div className="ac-actions">
                  <button className="ac-btn green pos">N</button>
                  <button className="ac-btn green pos">S</button>
                  <button className="ac-btn green pos">W</button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#a0d0a0', margin: '10px 0 6px 0' }}>Observers</div>
              <div className="ac-player-row">
                <span className="ac-name">Alice</span>
                <span className="ac-team">Unseated</span>
                <div className="ac-actions">
                  <button className="ac-btn green pos">N</button>
                  <button className="ac-btn green pos">S</button>
                  <button className="ac-btn green pos">E</button>
                  <button className="ac-btn green pos">W</button>
                  <button className="ac-btn red pos">✕</button>
                </div>
              </div>
              <div className="ac-player-row">
                <span className="ac-name">Dave</span>
                <span className="ac-team">@S</span>
                <div className="ac-actions">
                  <button className="ac-btn green pos">N</button>
                  <button className="ac-btn green pos">E</button>
                  <button className="ac-btn green pos">W</button>
                  <button className="ac-btn red pos">✕</button>
                </div>
              </div>
            </div>
            <div className="ac-panel">
              <h3>Game State</h3>
              <div className="ac-state">
                <div className="ac-state-item"><span className="ac-label">State</span><span className="ac-value">playing</span></div>
                <div className="ac-state-item"><span className="ac-label">Level</span><span className="ac-value">1</span></div>
                <div className="ac-state-item"><span className="ac-label">Bid</span><span className="ac-value">60</span></div>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
