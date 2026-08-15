import React from 'react';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['J', '9', 'A', '10', 'K', 'Q'];
const POSITIONS = ['N', 'E', 'S', 'W'];

function card(suit, rank) {
  return { suit, rank, toString: () => rank + suit };
}

function renderCard(c, small) {
  if (!c) return null;
  const isRed = c.suit === '♥' || c.suit === '♦';
  return (
    <span className={`card-face${small ? ' small' : ''}${isRed ? ' red' : ''}`}>
      <span className="card-suit-top">{c.suit}</span>
      <span className="card-rank-bottom">{c.rank}</span>
    </span>
  );
}

function renderMiniCard(c) {
  if (!c) return null;
  const isRed = c.suit === '♥' || c.suit === '♦';
  return <span className={`mini-card${isRed ? ' red' : ''}`}>{c.rank}<span className="suit-mark">{c.suit}</span></span>;
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
            <h3>Your bid</h3>
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
              <div className="current-action">Waiting for South to play</div>
            </div>
            <div className="trump-indicator"><span className="trump-revealed">♥ Trump</span></div>
          </div>
        </Row>
      </Section>

      <Section title="Notifications">
        <Row title="Toast">
          <div className="toast error">Something went wrong</div>
        </Row>
        <Row title="Timeout banner">
          <div className="timeout-banner">
            Player timed out <button>Take Over</button>
          </div>
        </Row>
        <Row title="Turn indicator">
          <div className="turn-indicator">Your turn!</div>
        </Row>
        <Row title="Waiting banner">
          <div className="waiting-banner">Waiting for a seat...</div>
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
              <h3>Gallery</h3>
              <div className="ac-player-row">
                <span className="ac-name">Alice</span>
                <span className="ac-actions">
                  <button className="ac-btn pos">N</button>
                  <button className="ac-btn pos">S</button>
                  <button className="ac-btn pos">E</button>
                  <button className="ac-btn pos">W</button>
                  <button className="ac-btn red">Kick</button>
                </span>
              </div>
            </div>
            <div className="ac-panel">
              <h3>Table</h3>
              <div className="ac-player-row">
                <span><span className="ac-name">Bob</span> <span className="ac-team">N (NS)</span></span>
                <span className="ac-actions"><button className="ac-btn red">Kick</button></span>
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
