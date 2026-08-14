import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import './index.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL;

const POSITION_NAMES = { N: 'North', S: 'South', E: 'East', W: 'West' };
const PARTNER = { N: 'S', S: 'N', E: 'W', W: 'E' };
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

function handHCPRequirement(bid) {
  return Math.round(bid * 1.5 + 85);
}

function App() {
  const [socket, setSocket] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [screen, setScreen] = useState('login');
  const [playerId, setPlayerId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const [name, setName] = useState(localStorage.getItem('tunny_name') || '');
  const [gameId, setGameId] = useState('');
  const [roomList, setRoomList] = useState({});
  const [error, setError] = useState('');
  const [cutCard, setCutCard] = useState(null);
  const [timedOut, setTimedOut] = useState(null);
  const [incBid, setIncBid] = useState(50);
  const actionLockRef = useRef(false);

  const sendOnce = useCallback((type, payload) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    socket.emit(type, payload);
  }, [socket]);

  const unlockAction = useCallback(() => { actionLockRef.current = false; }, []);


  const showError = useCallback((msg) => { setError(msg); setTimeout(() => setError(''), 5000); }, []);

  useEffect(() => {
    const s = SOCKET_URL ? io(SOCKET_URL) : io();
    setSocket(s);
    s.on('room_list', (list) => setRoomList(list));
    s.on('error', (e) => { showError(e.message); unlockAction(); });
    s.on('kicked', () => { setScreen('login'); setGameState(null); showError('You were kicked'); });
    s.on('demoted_to_spectator', (d) => {
      setIsSpectator(true);
      setIsAdmin(false);
      setScreen('game');
      if (d && d.message) showError(d.message); else showError('You are now a spectator');
    });
    return () => s.disconnect();
  }, [showError]);

  useEffect(() => {
    if (!socket) return;
    socket.on('room_joined', (data) => {
      setPlayerId(data.playerId);
      setIsAdmin(data.isAdmin);
      setIsSpectator(!!data.isSpectator);
      setGameId(data.gameId);
      setScreen(data.isAdmin ? 'game' : 'room');
    });
    socket.on('state', (state) => {
      unlockAction();
      setGameState(state);
      if (state.timedOutHand == null) setTimedOut(null);
      if (state.me) {
        setIsAdmin(state.me.isAdmin);
        setIsSpectator(!!state.me.isSpectator);
        setPlayerId(state.me.id);
      }
      if (state.state === 'hand_review') {
        setScreen('review');
      } else if (state.me?.isAdmin) {
        setScreen('game');
      } else if (state.state === 'waiting') {
        setScreen('game');
      } else {
        setScreen('game');
      }
    });
    socket.on('cut_start', () => { setScreen('game'); });
    socket.on('game_started', () => { setCutCard(null); });
    socket.on('game_over', () => setScreen('game'));
    socket.on('next_hand', () => setScreen('game'));
    socket.on('game_reset', () => { setScreen('login'); setGameState(null); setCutCard(null); });
    socket.on('player_timed_out', (d) => setTimedOut(d));
    socket.on('hand_end', () => setScreen('review'));
    socket.on('trump_selection', () => setScreen('game'));
    socket.on('game_playing', () => setScreen('game'));
    socket.on('trump_revealed', () => { /* state update handles it */ });
    socket.on('player_joined', () => {});
    socket.on('room_closed', (data) => {
      setGameState(null);
      setScreen('login');
      showError(data.message);
    });
    socket.on('player_left', (data) => {
      showError(`${data.playerName} dropped out`);
    });
    socket.on('player_demoted', (data) => {
      if (data.playerId === playerId) return;
      showError(`${data.playerName} was moved to spectator`);
    });
    socket.on('spectator_joined', () => {});
    socket.on('spectator_left', () => {});
    socket.on('spectator_promoted', (data) => {
      showError(`${data.playerName} promoted to player`);
    });
    socket.on('dealer_rotated', () => {});
    socket.on('admin_changed', () => { /* state update promotes the new admin */ });
  }, [socket]);

  useEffect(() => {
    if (gameState?.state === 'bidding') {
      const hb = gameState.highestBid || 0;
      setIncBid(hb === 0 ? 50 : Math.min(hb + 10, 170));
    }
  }, [gameState?.state, gameState?.highestBid]);

  const placeMyBid = () => {
    sendOnce('bid', { bid: incBid });
  };

  const joinGame = () => {
    if (!name) return showError('Enter your name');
    localStorage.setItem('tunny_name', name);
    socket.emit('create_room', { playerName: name });
  };

  // --- Login ---
  if (screen === 'login') {
    return (
      <div className="app login-screen">
        <h1 className="title">♠ TUNNY ♥</h1>
        <a href="/instructions" target="_blank" className="help-link" style={{ marginBottom: 12 }}>How to Play</a>
        {error && <div className="toast error">{error}</div>}
        <div className="login-box">
          <input placeholder="Your Name" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && joinGame()} />
          <button onClick={joinGame}>Join</button>
        </div>
        <div className="credit">This site is brought to you courtesy of <a href="https://render.com/" target="_blank" rel="noreferrer">https://render.com/</a></div>
      </div>
    );
  }

  if (!gameState) {
    return <div className="app"><div className="loading">Connecting...</div></div>;
  }

  const { me } = gameState;
  const myPos = me?.position;
  const players = gameState.players || [];

  function cardAt(idx) { return me?.hand?.[idx]; }

  // --- Room view removed: single global table, non-admin waiting players see the game table ---

  // --- Hand Review ---
  if (gameState.state === 'hand_review' && screen === 'review') {
    const tricks = gameState.trickHistory || [];
    const posOrder = ['N', 'S', 'E', 'W'];
    let nsRunning = 0;
    let ewRunning = 0;
    const rows = tricks.map(t => {
      const cardAt = {};
      for (const c of t.cards) cardAt[c.position] = c.card;
      const winValue = t.winnerPoints != null
        ? t.winnerPoints
        : (t.teamPoints?.['N-S'] || 0) + (t.teamPoints?.['E-W'] || 0);
      if (t.winnerTeam === 'N-S') nsRunning += winValue;
      else ewRunning += winValue;
      return {
        cards: cardAt,
        winner: t.winnerTeam,
        winnerPosition: t.winnerPosition,
        nsTotal: t.winnerTeam === 'N-S' ? nsRunning : null,
        ewTotal: t.winnerTeam === 'E-W' ? ewRunning : null
      };
    });
    return (
      <div className="app review-screen">
        <h2 className="review-title">Hand {gameState.handNumber} Review{gameState.highestBid ? <> · Highest Bid: {gameState.highestBid} ({handHCPRequirement(gameState.highestBid)} HCP)</> : ''}</h2>
        {error && <div className="toast error">{error}</div>}
        <div className="ac-trick-table review-table">
          <div className="ac-trick-table-header">
            <span className="ac-tt-trick">Trick</span>
            {posOrder.map(pos => {
              const p = players.find(x => x.position === pos);
              return (
                <span key={pos} className="ac-tt-card">{p?.name || POSITION_NAMES[pos]}{gameState.declarer?.position === pos && gameState.trumpSuit ? <span className={`trump-suit ${gameState.trumpSuit === '♥' || gameState.trumpSuit === '♦' ? 'red' : ''}`}>{gameState.trumpSuit}</span> : null}</span>
              );
            })}
            <span className="ac-tt-win">Winner</span>
            <span className="ac-tt-pts">N-S</span>
            <span className="ac-tt-pts">E-W</span>
          </div>
          {rows.map((r, i) => (
            <div key={i} className={`ac-trick-table-row${r.winner ? ` win-${r.winner === 'N-S' ? 'ns' : 'ew'}` : ''}`}>
              <span className="ac-tt-trick">{i + 1}</span>
              {posOrder.map(pos => {
                const isWinner = r.winnerPosition === pos;
                return (
                  <span key={pos} className="ac-tt-card">
                    {r.cards[pos] ? <span className={`mini-card${isWinner ? ' trick-winner' : ''} ${r.cards[pos].suit === '♥' || r.cards[pos].suit === '♦' ? 'red' : ''}`}>{r.cards[pos].rank}<span className="suit-mark">{r.cards[pos].suit}</span></span> : <span className="ac-empty" style={{ padding: 0 }}>—</span>}
                  </span>
                );
              })}
              <span className="ac-tt-win">{r.winner || '—'}</span>
              <span className="ac-tt-pts">{r.nsTotal != null ? `+${r.nsTotal}` : '·'}</span>
              <span className="ac-tt-pts">{r.ewTotal != null ? `+${r.ewTotal}` : '·'}</span>
            </div>
          ))}
        </div>
        {isAdmin && (
          <button className="start-btn" onClick={() => sendOnce('confirm_hand')}>
            Confirm & Next Hand
          </button>
        )}
        {!isAdmin && <p>Waiting for admin to confirm...</p>}
        <div className="credit">This site is brought to you courtesy of <a href="https://render.com/" target="_blank" rel="noreferrer">https://render.com/</a></div>
      </div>
    );
  }

  // --- Game over ---
  if (gameState.state === 'game_over') {
    return (
      <div className="app gameover-screen">
        <h2>Game Over</h2>
        <div className="winner-banner">{gameState.winner} Wins!</div>
        <div className="final-scores">
          <div className="score-card">
            <h3>N-S</h3>
            <div className="score-num">{gameState.scores?.['N-S'] || 0}</div>
            {players.filter(p => p.team === 'N-S').map(p => <div key={p.id}>{p.name}{gameState.declarer?.id === p.id && gameState.trumpSuit ? <span className={`trump-suit ${gameState.trumpSuit === '♥' || gameState.trumpSuit === '♦' ? 'red' : ''}`}>{gameState.trumpSuit}</span> : null}</div>)}
          </div>
          <div className="score-card">
            <h3>E-W</h3>
            <div className="score-num">{gameState.scores?.['E-W'] || 0}</div>
            {players.filter(p => p.team === 'E-W').map(p => <div key={p.id}>{p.name}{gameState.declarer?.id === p.id && gameState.trumpSuit ? <span className={`trump-suit ${gameState.trumpSuit === '♥' || gameState.trumpSuit === '♦' ? 'red' : ''}`}>{gameState.trumpSuit}</span> : null}</div>)}
          </div>
          </div>
          <a href="/instructions" target="_blank" className="help-link" style={{ marginTop: 16 }}>How to Play</a>
          <div className="credit">This site is brought to you courtesy of <a href="https://render.com/" target="_blank" rel="noreferrer">https://render.com/</a></div>
        </div>
    );
  }


  // ─── GAME TABLE (bidding / trump / playing) ───
  const isBidding = gameState.state === 'bidding';
  const isTrump = gameState.state === 'trump_selection';
  const isPlaying = gameState.state === 'playing';
  const highestBid = gameState.highestBid;

  const curPlayer = gameState.currentPlayer;
  const isMyTurn = curPlayer?.id === playerId;
  const isDeclarer = gameState.declarer?.id === playerId;
  const declarerPos = gameState.declarer?.position;
  const isDefender = myPos && declarerPos && PARTNER[myPos] !== declarerPos && myPos !== declarerPos;
  const vacatedTurnPos = curPlayer && curPlayer.id === null ? curPlayer.position : null;
  const vacatedPlayer = vacatedTurnPos ? vacatedAt(vacatedTurnPos) : null;
  const declarerVacated = gameState.declarer ? vacatedAt(gameState.declarer.position) : null;
  const timedOutHand = gameState.timedOutHand;
  const timedOutTurn = isAdmin && timedOutHand && curPlayer && curPlayer.id === timedOutHand.playerId;
  const timedOutDeclarer = isAdmin && timedOutHand && gameState.declarer && gameState.declarer.id === timedOutHand.playerId;

  // Trump action rules: hidden by default — only on your turn when you can't follow the led suit
  const ledSuit = gameState.currentTrick?.[0]?.card?.suit || null;
  const iHoldLeadSuit = !!ledSuit && (me?.hand || []).some(c => c.suit === ledSuit);
  const canTrumpAction = isMyTurn && !!ledSuit && !iHoldLeadSuit;
  const isLastTrick = gameState.trickNumber === 5;

  // Build table positions relative to viewer (admin has no position — fixed N/E/S/W)
  const ORDER = ['N', 'E', 'S', 'W'];
  let posOrder = ORDER.slice();
  if (myPos) {
    const myIdx = ORDER.indexOf(myPos);
    const opp = ORDER[(myIdx + 2) % 4];
    posOrder = [opp, ORDER[(myIdx + 3) % 4], myPos, ORDER[(myIdx + 1) % 4]];
  }

  function playerAtPos(pos) { return players.find(p => p.position === pos); }

  function faceDownCount(p) {
    if (!p) return 0;
    if (p.hand) return p.hand.length;
    return p.cardCount || 0;
  }

  function renderCard(c, small) {
    if (!c) return null;
    const isRed = c.suit === '♥' || c.suit === '♦';
    return <span className={`card-face${small ? ' small' : ''}${isRed ? ' red' : ''}`}>{c.rank}<span className="suit-mark">{c.suit}</span></span>;
  }

  function miniCard(c) {
    if (!c) return null;
    const isRed = c.suit === '♥' || c.suit === '♦';
    return <span className={`mini-card ${isRed ? ' red' : ''}`}>{c.rank}<span className="suit-mark">{c.suit}</span></span>;
  }

  function vacatedAt(pos) {
    return (gameState.vacatedHands || []).find(v => v.position === pos) || null;
  }

  function renderVacated(pos, vertical) {
    const v = vacatedAt(pos);
    if (!v) return null;
    const isTurn = curPlayer && curPlayer.id === null && curPlayer.position === pos;
    const clickable = isAdmin && isPlaying && isTurn;
    const vacatedHoldsLead = !!ledSuit && (v.hand || []).some(c => c.suit === ledSuit);
    const isVacatedDeclarer = isPlaying && gameState.declarer && gameState.declarer.position === pos;
    const vacatedTrumpAllowed = isAdmin && isPlaying && isTurn && isVacatedDeclarer && gameState.trumpCard && !gameState.trumpRevealed && (isLastTrick || (!!ledSuit && !vacatedHoldsLead));
    return (
      <div className={`vacated-hand${vertical ? ' vert' : ''}`}>
        {isAdmin && isTurn && <div className="vacated-tag">Play for {v.playerName}</div>}
        {v.hand.map((c, i) => (
          <button key={i} className="vacated-card-btn" disabled={!clickable}
            onClick={() => clickable && (setTimedOut(null), sendOnce('admin_play', { position: pos, card: { suit: c.suit, rank: c.rank } }))}>
            {renderCard(c)}
          </button>
        ))}
        {vacatedTrumpAllowed && (
          <button className="action-btn" onClick={() => (setTimedOut(null), sendOnce('admin_play', { position: pos, trump: true }))}>
            Play Trump (take over)
          </button>
        )}
      </div>
    );
  }

  function renderTimedOut() {
    if (!timedOutHand) return null;
    const isTurn = curPlayer && curPlayer.id === timedOutHand.playerId;
    const clickable = isAdmin && isPlaying && isTurn;
    const timedOutHoldsLead = !!ledSuit && (timedOutHand.hand || []).some(c => c.suit === ledSuit);
    const isTimedOutDeclarer = isPlaying && gameState.declarer && gameState.declarer.id === timedOutHand.playerId;
    const timedOutTrumpAllowed = isAdmin && isPlaying && isTurn && isTimedOutDeclarer && gameState.trumpCard && !gameState.trumpRevealed && (isLastTrick || (!!ledSuit && !timedOutHoldsLead));
    return (
      <div className="vacated-hand">
        {isAdmin && isTurn && <div className="vacated-tag">Play for {timedOutHand.playerName}</div>}
        {timedOutHand.hand.map((c, i) => (
          <button key={i} className="vacated-card-btn" disabled={!clickable}
            onClick={() => clickable && (setTimedOut(null), sendOnce('admin_play', { targetId: timedOutHand.playerId, card: { suit: c.suit, rank: c.rank } }))}>
            {renderCard(c)}
          </button>
        ))}
        {timedOutTrumpAllowed && (
          <button className="action-btn" onClick={() => (setTimedOut(null), sendOnce('admin_play', { targetId: timedOutHand.playerId, trump: true }))}>
            Play Trump (take over)
          </button>
        )}
      </div>
    );
  }

  let adminPanel = null;
  if (isAdmin && !isSpectator) {
    const unseated = players.filter(p => !p.position);
    const trickOrder = ['N', 'S', 'E', 'W'];
    adminPanel = (
      <div className="admin-panel">
        <div className="ac-grid">
          {/* Left: Gallery + Table Seats */}
          <div className="ac-panel">
            <h3>Gallery ({unseated.length})</h3>
            {unseated.length === 0 ? (
              <div className="ac-empty">No waiting players</div>
            ) : unseated.map(p => (
              <div key={p.id} className="ac-player-row">
                <span className="ac-name">{p.name}</span>
                <div className="ac-actions">
                  {['N','S','E','W'].filter(pos => !gameState.positions?.[pos]).map(pos => (
                    <button key={pos} className="ac-btn green pos"
                      onClick={() => socket.emit('assign_position', { playerId: p.id, position: pos })}>
                      {pos}
                    </button>
                  ))}
                  {p.id !== playerId && (
                    <button className="ac-btn red pos" onClick={() => socket.emit('kick_player', { targetId: p.id })}>✕</button>
                  )}
                </div>
              </div>
            ))}
            <h3 style={{ marginTop: 12 }}>Table</h3>
            {['N','S','E','W'].map(pos => {
              const pid = gameState.positions?.[pos];
              const p = players.find(x => x.id === pid);
              return (
                <div key={pos} className="ac-player-row">
                  <span style={{ fontWeight: 700, width: 20 }}>{pos}</span>
                  {p ? (
                    <>
                      <span className="ac-name">{p.name}</span>
                      <span className="ac-team">{p.team || '—'}</span>
                      <div className="ac-actions">
                        {isAdmin && p.id !== playerId && (
                          <button className="ac-btn red" onClick={() => socket.emit('kick_player', { targetId: p.id })}>✕</button>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="ac-empty">— empty —</span>
                  )}
                </div>
              );
            })}
            {gameState.spectators?.length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>Spectators ({gameState.spectators.length})</h3>
                {gameState.spectators.map(s => (
                  <div key={s.id} className="ac-player-row">
                    <span className="ac-name">{s.name}</span>
                    <div className="ac-actions">
                      {['N','S','E','W'].filter(pos => !gameState.positions?.[pos]).map(pos => (
                        <button key={pos} className="ac-btn green pos"
                          onClick={() => sendOnce('promote_to_player', { spectatorId: s.id, position: pos })}>
                          {pos}
                        </button>
                      ))}
                      {players.length < 4 && (
                        <button className="ac-btn gray pos" title="Move to gallery"
                          onClick={() => sendOnce('promote_to_player', { spectatorId: s.id })}>
                          →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Center: Game State + Bids + Current Trick */}
          <div className="ac-panel">
            <h3>Game State</h3>
            <div className="ac-state">
              <div className="ac-state-item"><span className="ac-label">Hand</span><span className="ac-value">{gameState.handNumber}/6</span></div>
              <div className="ac-state-item"><span className="ac-label">Trick</span><span className="ac-value">{gameState.trickNumber + 1}/6</span></div>
              <div className="ac-state-item"><span className="ac-label">State</span><span className="ac-value" style={{ fontSize: 11 }}>{gameState.state}</span></div>
              {gameState.dealer && <div className="ac-state-item"><span className="ac-label">Dealer</span><span className="ac-value" style={{ fontSize: 11 }}>{players.find(p => p.id === gameState.dealer.id)?.name || gameState.dealer.position}</span></div>}
              {gameState.contractLevel && <div className="ac-state-item"><span className="ac-label">Level</span><span className="ac-value">{gameState.contractLevel} ({gameState.targetTricks} tr)</span></div>}
              {gameState.declarer && <div className="ac-state-item"><span className="ac-label">Declarer</span><span className="ac-value" style={{ fontSize: 11 }}>{players.find(p => p.id === gameState.declarer.id)?.name || gameState.declarer.position}</span></div>}
              {gameState.highestBid && <div className="ac-state-item"><span className="ac-label">Bid</span><span className="ac-value">{gameState.highestBid}</span></div>}
              {gameState.trumpSuit && <div className="ac-state-item"><span className="ac-label">Trump</span><span className="ac-value">{gameState.trumpSuit}</span></div>}
            </div>

            <h3 style={{ marginTop: 12 }}>Bids</h3>
            {players.map(p => (
              <div key={p.id} className="ac-player-row">
                <span className="ac-name">{p.name}</span>
                <span>{p.bid || '—'}</span>
              </div>
            ))}

          </div>

          {/* Right: Controls */}
          <div className="ac-panel">
            <h3>Controls</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {gameState.state === 'waiting' && (
                <button className="ac-btn green"
                  disabled={Object.keys(gameState.positions || {}).length < 4}
                  onClick={() => sendOnce('start_game')}>
                  Start Game
                </button>
              )}
              {gameState.state === 'cut' && (
                <button className="ac-btn green" onClick={() => sendOnce('cut_done')}>Reveal Cut Results</button>
              )}
                <button className="ac-btn blue" onClick={() => sendOnce('rotate_dealer')}>Move Dealer</button>
                <button className="ac-btn orange" onClick={() => sendOnce('reset_scores')}>Reset Scores</button>
                <button className="ac-btn orange" onClick={() => sendOnce('reset_game')}>Reset Game</button>
              {timedOut && timedOut.playerId && (
                <button className="ac-btn blue" onClick={() => { setTimedOut(null); sendOnce('admin_play', { targetId: timedOut.playerId }); }}>
                  Take Over ({timedOut.playerName})
                </button>
              )}
              {!timedOut && (
                <button className="ac-btn green" onClick={() => sendOnce('confirm_hand')}>
                  Confirm & Next Hand
                </button>
              )}
          </div>
        </div>
      </div>

        {/* Live Tricks + Scores */}
        <div className="ac-panel ac-wide" style={{ marginTop: 12 }}>
          <h3>Tricks & Scores <span style={{ fontWeight: 400, fontSize: 11, color: '#a0d0a0' }}>(live)</span></h3>
          {(gameState.trickHistory?.length > 0 || gameState.currentTrick?.length > 0) ? (
            <div className="ac-trick-table">
              <div className="ac-trick-table-header">
                <span className="ac-tt-trick">Trick</span>
                {trickOrder.map(pos => {
                  const pn = players.find(x => x.position === pos);
                  return (
                    <span key={pos} className="ac-tt-card">{pn?.name || POSITION_NAMES[pos]}</span>
                  );
                })}
                <span className="ac-tt-win">Winner</span>
                <span className="ac-tt-pts">N-S</span>
                <span className="ac-tt-pts">E-W</span>
              </div>
              {gameState.currentTrick?.length > 0 && (
                <div className="ac-trick-table-row current">
                  <span className="ac-tt-trick">{gameState.trickNumber + 1}*</span>
                  {trickOrder.map(pos => {
                    const entry = gameState.currentTrick.find(t => t.position === pos);
                    return (
                      <span key={pos} className="ac-tt-card">
                        {entry?.card ? (
                          <span className={`mini-card ${entry.card.suit === '♥' || entry.card.suit === '♦' ? 'red' : ''}`}>
                            {entry.card.rank}<span className="suit-mark">{entry.card.suit}</span>
                          </span>
                        ) : <span className="ac-empty" style={{ padding: 0 }}>·</span>}
                      </span>
                    );
                  })}
                  <span className="ac-tt-win">…</span>
                  <span className="ac-tt-pts">—</span>
                  <span className="ac-tt-pts">—</span>
                </div>
              )}
              {gameState.trickHistory.map((t, i) => {
                const winValue = t.winnerPoints != null
                  ? t.winnerPoints
                  : (t.teamPoints?.['N-S'] || 0) + (t.teamPoints?.['E-W'] || 0);
                const winnerIdx = t.cards.findIndex(c => c.position === t.winnerPosition);
                return (
                  <div key={i} className={`ac-trick-table-row${t.winnerTeam === 'N-S' ? ' win-ns' : ' win-ew'}`}>
                    <span className="ac-tt-trick">{t.trickNumber + 1}</span>
                    {trickOrder.map(pos => {
                      const entry = t.cards.find(c => c.position === pos);
                      const isWinner = entry && winnerIdx !== -1 && t.cards[winnerIdx].position === pos;
                      return (
                        <span key={pos} className="ac-tt-card">
                          {entry ? (
                            <span className={`mini-card${isWinner ? ' trick-winner' : ''} ${entry.card.suit === '♥' || entry.card.suit === '♦' ? 'red' : ''}`}>
                              {entry.card.rank}<span className="suit-mark">{entry.card.suit}</span>
                            </span>
                          ) : <span className="ac-empty" style={{ padding: 0 }}>—</span>}
                        </span>
                      );
                    })}
                    <span className="ac-tt-win">{t.winnerTeam}</span>
                    <span className="ac-tt-pts">{t.winnerTeam === 'N-S' ? `+${winValue}` : '·'}</span>
                    <span className="ac-tt-pts">{t.winnerTeam === 'E-W' ? `+${winValue}` : '·'}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ac-empty">No tricks yet — waiting for play to start</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app game-table">
      {error && <div className="toast error">{error}</div>}
      {timedOut && (
        <div className="timeout-banner">
          {timedOut.playerId ? `${timedOut.playerName} timed out!` : `${timedOut.playerName}'s seat needs you!`}
          {isAdmin && timedOut.playerId && (
            <button onClick={() => { setTimedOut(null); sendOnce('admin_play', { targetId: timedOut.playerId }); }}>Take Over</button>
          )}
          {isAdmin && !timedOut.playerId && <span> — play their seat below</span>}
        </div>
      )}

      {/* Top: current state message + scores */}
      {!isAdmin && gameState.state === 'waiting' && (
        <div className="waiting-banner">Waiting for Admin to assign a seat</div>
      )}
      <div className="state-bar">
        <div className="team-scores">
          <div className="ts-row header"><span></span><span>Score</span><span>HCP</span></div>
          <div className="ts-row ns"><span>N-S</span><span>{gameState.scores?.['N-S'] || 0}</span><span>{gameState.teamPoints?.['N-S'] || 0}</span></div>
          <div className="ts-row ew"><span>E-W</span><span>{gameState.scores?.['E-W'] || 0}</span><span>{gameState.teamPoints?.['E-W'] || 0}</span></div>
          <a href="/instructions" target="_blank" className="help-link">How to Play</a>
        </div>
        <div className="state-info">
          <div className="round-info">Hand {gameState.handNumber} · Trick {gameState.trickNumber + 1}/6</div>
          <div className="current-action">
            {gameState.state === 'waiting' && (isAdmin ? `Waiting — assign positions and start the game` : `Waiting for Admin to assign a seat`)}
            {gameState.state === 'cut' && `Waiting for ${players.find(p => p.isAdmin)?.name || 'admin'} to cut the deck`}
            {isBidding && `${curPlayer?.name} is bidding${isAdmin && vacatedTurnPos ? ' — you bid this seat' : ''}`}
            {isTrump && `${players.find(p => p.position === gameState.declarer?.position)?.name || 'Declarer'} is selecting trump${isAdmin && declarerVacated ? ' — you choose for this seat' : ''}`}
            {isPlaying && `${curPlayer?.name}'s turn${isAdmin && vacatedTurnPos ? ' — you play this seat' : ''}`}
            {gameState.state === 'hand_review' && 'Hand review — waiting for admin to confirm'}
            {gameState.state === 'game_over' && `${gameState.winner} wins!`}
          </div>
          <div className="state-details">
            {isPlaying && gameState.trumpSuit && <div className="trump-indicator">Trump: {gameState.trumpSuit}</div>}
            {gameState.trumpCard && <div className="trump-card-display"><span className="trump-card-label">Trump card:</span>{renderCard(gameState.trumpCard)}</div>}
            {gameState.trumpRevealed && <div className="trump-revealed">♠ Trump Revealed! ♠</div>}
            {gameState.contractLevel && <div>Contract: Level {gameState.contractLevel} ({gameState.targetTricks} tricks)</div>}
          </div>
        </div>
        {isPlaying && gameState.currentTrick?.length > 0 && (
          <div className="current-trick">
            {gameState.currentTrick.map((t, i) => (
              <div key={i} className="trick-entry">
                <span>{t.playerName}</span>
                {t.card ? renderCard(t.card) : <span className="card-back tiny" />}
              </div>
            ))}
          </div>
        )}
        {gameState.state === 'cut' && (
          <div className="current-trick cut-card-area">
            {me?.cutCard ? (
              <div className="cut-card">
                <div className={`card ${me.cutCard.suit === '♥' || me.cutCard.suit === '♦' ? 'red' : ''}`}>
                  <span className="rank">{me.cutCard.rank}</span>
                  <span className="suit">{me.cutCard.suit}</span>
                </div>
                <span className="cut-card-label">Your card</span>
              </div>
            ) : (
              <div className="ac-empty">Waiting for cut results...</div>
            )}
            {isAdmin && (
              <button className="start-btn" onClick={() => sendOnce('cut_done')}>Reveal Cut Results</button>
            )}
          </div>
        )}
      </div>

{/* Bidding overlay — top of screen */}
  {isBidding && (
    <div className={`overlay bidding-top${isMyTurn || (isAdmin && (vacatedTurnPos || timedOutTurn)) ? ' active' : ''}`}>
      <h3>Bidding</h3>
      {isMyTurn && (
        <div className="bid-buttons">
          <button onClick={() => sendOnce('bid', { bid: 'pass' })} className="bid-pass">Pass</button>
          <button onClick={placeMyBid} className="bid-inc">{incBid}</button>
          <div className="bid-stepper">
            <button onClick={() => setIncBid(v => Math.min(v + 10, 170))} className="bid-arrow up" aria-label="Increase bid">▲</button>
            <span className="bid-hcp">{handHCPRequirement(incBid)}</span>
            <button onClick={() => setIncBid(v => Math.max(Math.max(50, (highestBid || 0) + 10), v - 10))} className="bid-arrow down" aria-label="Decrease bid">▼</button>
          </div>
        </div>
      )}
      {isAdmin && (vacatedPlayer || timedOutTurn) && (
        <>
          <p style={{ marginTop: 8, color: '#a0d0a0' }}>Bidding for {curPlayer?.name}:</p>
          <div className="bid-buttons">
            {vacatedPlayer && (
              <div className="bid-buttons admin">
                <button onClick={() => sendOnce('admin_play', { position: vacatedPlayer.pos, card: incBid })} className="bid-inc">{incBid}</button>
                <div className="bid-stepper">
                  <button onClick={() => setIncBid(v => Math.min(v + 10, 170))} className="bid-arrow up" aria-label="Increase bid">▲</button>
                  <span className="bid-hcp">{handHCPRequirement(incBid)}</span>
                  <button onClick={() => setIncBid(v => Math.max(Math.max(50, (highestBid || 0) + 10), v - 10))} className="bid-arrow down" aria-label="Decrease bid">▼</button>
                </div>
              </div>
            )}
            {timedOutTurn && (
              <div className="bid-buttons admin">
                <button onClick={() => { setTimedOut(null); sendOnce('admin_play', { targetId: timedOutHand.playerId, card: incBid }); }} className="bid-inc">{incBid}</button>
                <div className="bid-stepper">
                  <button onClick={() => setIncBid(v => Math.min(v + 10, 170))} className="bid-arrow up" aria-label="Increase bid">▲</button>
                  <span className="bid-hcp">{handHCPRequirement(incBid)}</span>
                  <button onClick={() => setIncBid(v => Math.max(Math.max(50, (highestBid || 0) + 10), v - 10))} className="bid-arrow down" aria-label="Decrease bid">▼</button>
                </div>
              </div>
            )}
            <button onClick={() => sendOnce('admin_play', { position: (vacatedPlayer || {}).pos, targetId: timedOutHand?.playerId, card: 'pass' })} className="bid-pass">Pass</button>
          </div>
        </>
      )}
      <div className="bid-summary">
        {players.map(p => <span key={p.id || p.position} className="bid-summary-item">{p.name}: {p.bid || '—'}</span>)}
      </div>
    </div>
  )}

      {/* Opponents + partner */}
      <div className="opponents-row">
        {[
          { cls: 'opp1', pos: posOrder[3] },
          { cls: 'partner', pos: posOrder[0] },
          { cls: 'opp2', pos: posOrder[1] }
        ].map(({ cls, pos }) => {
          const p = playerAtPos(pos);
          const label = cls === 'partner' ? 'Partner' : null;
          return (
            <div key={cls} className={`table-seat ${cls}`}>
              {vacatedAt(pos) ? renderVacated(pos, true) : (
                <div className="dummy-card" title={`${p?.name || POSITION_NAMES[pos]} — ${faceDownCount(p)} cards`}>
                  <span className="dummy-name">{p?.name || POSITION_NAMES[pos]}</span>
                  {label && <span className="dummy-role">{label}</span>}
                  <span className="dummy-count">{faceDownCount(p)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Center stage for overlays (trump) */}
      <div className="center-stage">
        {isTrump && (
          <div className="overlay active">
            <h3>Select Trump</h3>
            {isDeclarer ? (
              <div className="trump-cards">
                {(me?.hand || []).map((c, i) => (
                  <button key={i} className="card-btn" onClick={() => sendOnce('choose_trump', { card: { suit: c.suit, rank: c.rank } })}>
                    {renderCard(c)}
                  </button>
                ))}
              </div>
            ) : isAdmin && declarerVacated ? (
              <div>
                <p style={{ marginBottom: 8, color: '#a0d0a0' }}>Choose trump for {declarerVacated.playerName}</p>
                <div className="trump-cards">
                  {(declarerVacated.hand || []).map((c, i) => (
                    <button key={i} className="card-btn" onClick={() => sendOnce('admin_play', { position: declarerVacated.position, card: { suit: c.suit, rank: c.rank } })}>
                      {renderCard(c)}
                    </button>
                  ))}
                </div>
              </div>
            ) : isAdmin && timedOutDeclarer ? (
              <div>
                <p style={{ marginBottom: 8, color: '#a0d0a0' }}>Choose trump for {timedOutHand.playerName}</p>
                <div className="trump-cards">
                  {(timedOutHand.hand || []).map((c, i) => (
                    <button key={i} className="card-btn" onClick={() => { setTimedOut(null); sendOnce('admin_play', { targetId: timedOutHand.playerId, card: { suit: c.suit, rank: c.rank } }); }}>
                      {renderCard(c)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p>Waiting for {players.find(p => p.position === gameState.declarer?.position)?.name || 'declarer'} to choose trump...</p>
            )}
          </div>
        )}
      </div>

      {/* Turn indicator */}
      {isMyTurn && isPlaying && !isSpectator && <div className="turn-indicator">Your turn!</div>}

      {/* My hand */}
      <div className="my-area">
        {timedOutHand ? renderTimedOut() : (
          vacatedAt(posOrder[2]) ? renderVacated(posOrder[2]) : (
            (isAdmin && !isSpectator) ? (
              <div style={{ minHeight: 30 }} />
            ) : isSpectator ? (
              <div className="spectator-label">Observing</div>
            ) : (
              <div className="my-hand">
                {(me?.hand || []).map((c, i) => {
                  const canPlay = isMyTurn && isPlaying && !isBidding && !isTrump;
                  return (
                    <button key={i} className="hand-card"
                      disabled={!canPlay}
                      onClick={() => canPlay && sendOnce('play', { card: { suit: c.suit, rank: c.rank } })}>
                      {renderCard(c)}
                    </button>
                  );
                })}
              </div>
            )
          )
        )}
        {isDeclarer && isPlaying && gameState.trumpCard && !gameState.trumpRevealed && (
          <div className="trump-reserved">
            {renderCard(gameState.trumpCard)}
            <span className="trump-reserved-label">TRUMP</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="action-bar">
        {(isPlaying || isBidding || isTrump) && !isSpectator && (
          <>
            {isPlaying && !isDeclarer && !isAdmin && !gameState.trumpRevealed && canTrumpAction && (
              <button className="action-btn" onClick={() => sendOnce('ask_trump')}>Ask Trump</button>
            )}
            {isPlaying && isDeclarer && !isAdmin && !gameState.trumpRevealed && gameState.trumpCard && isMyTurn &&
              (isLastTrick || canTrumpAction) && (
              <button className="action-btn" onClick={() => sendOnce('play_trump')}>Play Trump</button>
            )}
          </>
        )}
      </div>

      {/* Admin Panel (collapsible) */}
      {adminPanel}
    </div>
  );
}

export default App;
