import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import './index.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL;

const POSITION_NAMES = { N: 'North', S: 'South', E: 'East', W: 'West' };
const PARTNER = { N: 'S', S: 'N', E: 'W', W: 'E' };
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

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
      if (state.me) {
        setIsAdmin(state.me.isAdmin);
        setIsSpectator(!!state.me.isSpectator);
        setPlayerId(state.me.id);
      }
      if (state.state === 'hand_review') {
        setScreen('review');
      } else if (state.me?.isAdmin) {
        setScreen('game');
      } else if (state.state === 'cut') {
        setScreen('cut');
      } else if (state.state === 'waiting') {
        setScreen('room');
      } else {
        setScreen('game');
      }
    });
    socket.on('cut_start', () => { setScreen('cut'); });
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
    socket.on('spectator_joined', () => {});
    socket.on('spectator_left', () => {});
    socket.on('spectator_promoted', (data) => {
      showError(`${data.playerName} promoted to player`);
    });
    socket.on('dealer_rotated', () => {});
  }, [socket]);

  const createRoom = () => {
    if (!name) return showError('Enter your name');
    localStorage.setItem('tunny_name', name);
    socket.emit('create_room', { playerName: name });
  };

  const joinRoom = (id) => {
    if (!name) return showError('Enter your name');
    localStorage.setItem('tunny_name', name);
    setGameId(id);
    socket.emit('join_room', { gameId: id, playerName: name });
  };

  const observeRoom = (id) => {
    if (!name) return showError('Enter your name');
    localStorage.setItem('tunny_name', name);
    setGameId(id);
    socket.emit('join_as_spectator', { gameId: id, playerName: name + ' (obs)' });
  };

  // --- Login / Gallery ---
  if (screen === 'login') {
    return (
      <div className="app login-screen">
        <h1 className="title">♠ TUNNY ♥</h1>
        <a href="/instructions" target="_blank" className="help-link" style={{ marginBottom: 12 }}>How to Play</a>
        {error && <div className="toast error">{error}</div>}
        <div className="login-box">
          <input placeholder="Your Name" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createRoom()} />
          <button onClick={createRoom}>Create Room</button>
          <div className="room-list">
            <h3>Active Rooms</h3>
            {Object.keys(roomList).length === 0 && <p className="muted">No rooms yet</p>}
            {Object.entries(roomList).map(([id, r]) => (
              <div key={id} className="room-entry">
                <span className="room-id">{id.slice(0, 8)}</span>
                <span>{r.playerCount}/4 players</span>
                <button onClick={() => joinRoom(id)}>Join</button>
                <button className="observe-btn" onClick={() => observeRoom(id)}>Observe</button>
              </div>
            ))}
          </div>
        </div>
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

  // --- Room view (admin uses the admin/game screen instead) ---
  if (!isAdmin && (gameState.state === 'waiting' || gameState.state === 'cut')) {
    return (
      <div className="app room-screen">
        <h2>Room: {gameId || gameState.roomId?.slice(0, 8)}</h2>
        <div className="host-info">Host: {gameState.admin?.name || (isAdmin ? name : 'Unknown')}</div>
        {error && <div className="toast error">{error}</div>}
        <div className="seating">
          {['N', 'S', 'E', 'W'].map(pos => {
            const pid = gameState.positions?.[pos];
            const p = players.find(x => x.id === pid);
            return (
              <div key={pos} className={`seat ${pos}`}>
                <div className="seat-label">{POSITION_NAMES[pos]}</div>
                {p ? (
                  <div className="seat-player">
                    <span>{p.name}</span>
                    {p.isAdmin && <span className="badge">Admin</span>}
                  </div>
                ) : (
                  <div className="seat-empty">
                    {isAdmin && <button onClick={() => {
                      const unseated = players.find(x => x.id !== playerId && !x.position);
                      if (unseated) socket.emit('assign_position', { playerId: unseated.id, position: pos });
                    }}>Assign</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="unseated">
          {players.filter(p => !p.position).map(p => (
            <div key={p.id} className="player-chip">
              {p.name} {p.isAdmin && '(Admin)'}
              {isAdmin && gameState.state === 'waiting' && ['N','S','E','W'].map(pos =>
                !gameState.positions?.[pos] && (
                  <button key={pos} className="mini-btn"
                    onClick={() => socket.emit('assign_position', { playerId: p.id, position: pos })}>
                    {pos}
                  </button>
                )
              )}
              {isAdmin && p.id !== playerId && (
                <button className="mini-btn kick" onClick={() => socket.emit('kick_player', { targetId: p.id })}>✕</button>
              )}
            </div>
          ))}
        </div>
        {gameState.spectators?.length > 0 && (
          <div className="spectator-list">
            <h4>Spectators ({gameState.spectators.length})</h4>
            {gameState.spectators.map(s => (
              <div key={s.id} className="player-chip">
                {s.name}
                {isAdmin && players.length < 4 && (
                  <button className="mini-btn" onClick={() => socket.emit('promote_to_player', { spectatorId: s.id })}>Promote</button>
                )}
              </div>
            ))}
          </div>
        )}
        {isAdmin && gameState.state === 'waiting' && (
          <button className="start-btn"
            disabled={Object.keys(gameState.positions || {}).length < 4}
            onClick={() => sendOnce('start_game')}>
            Start Game
          </button>
        )}
        {gameState.state === 'cut' && isAdmin && (
          <button className="start-btn" onClick={() => sendOnce('cut_done')}>Reveal Cut Results</button>
        )}
      </div>
    );
  }

  // --- Cut phase ---
  if (gameState.state === 'cut' && screen === 'cut') {
    const myCut = me?.cutCard;
    return (
      <div className="app">
        <h2>Cut for Dealer</h2>
        {myCut ? (
          <div className="cut-display">
            <div className={`card ${myCut.suit === '♥' || myCut.suit === '♦' ? 'red' : ''}`}>
              <span className="rank">{myCut.rank}</span>
              <span className="suit">{myCut.suit}</span>
            </div>
            <p>Your card: {myCut.rank}{myCut.suit}</p>
            {isAdmin && <button className="start-btn" onClick={() => sendOnce('cut_done')}>Continue</button>}
          </div>
        ) : (
          <p>Waiting for cut results...</p>
        )}
      </div>
    );
  }

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
        nsTotal: t.winnerTeam === 'N-S' ? nsRunning : null,
        ewTotal: t.winnerTeam === 'E-W' ? ewRunning : null
      };
    });
    return (
      <div className="app review-screen">
        <h2>Hand {gameState.handNumber} Review</h2>
        {error && <div className="toast error">{error}</div>}
        <div className="review-grid">
          <div className="review-grid-row header">
            {posOrder.map(pos => {
              const p = players.find(x => x.position === pos);
              return (
                <div key={pos}>{p?.name || POSITION_NAMES[pos]}{gameState.declarer?.position === pos && gameState.trumpSuit ? <span className={`trump-suit ${gameState.trumpSuit === '♥' || gameState.trumpSuit === '♦' ? 'red' : ''}`}>{gameState.trumpSuit}</span> : null}</div>
              );
            })}
            <div>N-S</div><div>E-W</div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className={`review-grid-row${r.winner ? ` win-${r.winner === 'N-S' ? 'ns' : 'ew'}` : ''}`}>
              {posOrder.map(pos => (
                <div key={pos} className="review-grid-card">
                  {r.cards[pos] ? <span className={`mini-card ${r.cards[pos].suit === '♥' || r.cards[pos].suit === '♦' ? 'red' : ''}`}>{r.cards[pos].rank}{r.cards[pos].suit}</span> : <span className="ac-empty">—</span>}
                </div>
              ))}
              <div className="review-grid-pts">{r.nsTotal != null ? r.nsTotal : ''}</div>
              <div className="review-grid-pts">{r.ewTotal != null ? r.ewTotal : ''}</div>
            </div>
          ))}
        </div>
        {isAdmin && (
          <button className="start-btn" onClick={() => sendOnce('confirm_hand')}>
            {gameState.handNumber >= 6 ? 'End Game' : 'Confirm & Next Hand'}
          </button>
        )}
        {!isAdmin && <p>Waiting for admin to confirm...</p>}
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
            {players.filter(p => p.team === 'N-S').map(p => <div key={p.id}>{p.name}</div>)}
          </div>
          <div className="score-card">
            <h3>E-W</h3>
            <div className="score-num">{gameState.scores?.['E-W'] || 0}</div>
            {players.filter(p => p.team === 'E-W').map(p => <div key={p.id}>{p.name}</div>)}
          </div>
          </div>
          <a href="/instructions" target="_blank" className="help-link" style={{ marginTop: 16 }}>How to Play</a>
        </div>
    );
  }


  // ─── GAME TABLE (bidding / trump / playing) ───
  const isBidding = gameState.state === 'bidding';
  const isTrump = gameState.state === 'trump_selection';
  const isPlaying = gameState.state === 'playing';

  const curPlayer = gameState.currentPlayer;
  const isMyTurn = curPlayer?.id === playerId;
  const isDeclarer = gameState.declarer?.id === playerId;
  const declarerPos = gameState.declarer?.position;
  const isDefender = myPos && declarerPos && PARTNER[myPos] !== declarerPos && myPos !== declarerPos;
  const vacatedTurnPos = curPlayer && curPlayer.id === null ? curPlayer.position : null;
  const declarerVacated = gameState.declarer ? vacatedAt(gameState.declarer.position) : null;

  // Trump action rules: available whenever the current trick has started
  const canAskTrump = (gameState.currentTrick?.length || 0) > 0;
  const canPlayTrump = (gameState.currentTrick?.length || 0) > 0;

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
    return <span className={`card-face${small ? ' small' : ''}${isRed ? ' red' : ''}`}>{c.rank}{c.suit}</span>;
  }

  function miniCard(c) {
    if (!c) return null;
    const isRed = c.suit === '♥' || c.suit === '♦';
    return <span className={`mini-card ${isRed ? ' red' : ''}`}>{c.rank}{c.suit}</span>;
  }

  function vacatedAt(pos) {
    return (gameState.vacatedHands || []).find(v => v.position === pos) || null;
  }

  function renderVacated(pos, vertical) {
    const v = vacatedAt(pos);
    if (!v) return null;
    const isTurn = curPlayer && curPlayer.id === null && curPlayer.position === pos;
    const clickable = isAdmin && isPlaying && isTurn;
    return (
      <div className={`vacated-hand${vertical ? ' vert' : ''}`}>
        {isAdmin && isTurn && <div className="vacated-tag">Play for {v.playerName}</div>}
        {v.hand.map((c, i) => (
          <button key={i} className="vacated-card-btn" disabled={!clickable}
            onClick={() => clickable && (setTimedOut(null), sendOnce('admin_play', { position: pos, card: { suit: c.suit, rank: c.rank } }))}>
            {miniCard(c)}
          </button>
        ))}
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
                    <button key={pos} className="ac-btn green"
                      onClick={() => socket.emit('assign_position', { playerId: p.id, position: pos })}>
                      {pos}
                    </button>
                  ))}
                  {p.id !== playerId && (
                    <button className="ac-btn red" onClick={() => socket.emit('kick_player', { targetId: p.id })}>✕</button>
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
                      {players.length < 4 && ['N','S','E','W'].filter(pos => !gameState.positions?.[pos]).map(pos => (
                        <button key={pos} className="ac-btn green"
                          onClick={() => sendOnce('promote_to_player', { spectatorId: s.id, position: pos })}>
                          {pos}
                        </button>
                      ))}
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

            <h3 style={{ marginTop: 12 }}>Current Trick</h3>
            {gameState.currentTrick?.length > 0 ? (
              <div className="ac-tricks">
                {gameState.currentTrick.map((t, i) => (
                  <div key={i} className="ac-trick-row">
                    <span className="ac-trick-winner">{t.playerName}</span>
                    <span className="ac-trick-cards">{t.card?.rank}{t.card?.suit}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ac-empty">No cards played yet</div>
            )}
          </div>

          {/* Right: Scores + Controls */}
          <div className="ac-panel">
            <h3>Scores</h3>
            <div className="ac-player-row" style={{ background: '#2d4a7a', borderRadius: 4 }}><span>N-S</span><span>{gameState.scores?.['N-S'] || 0}</span></div>
            <div className="ac-player-row" style={{ background: '#7a2d2d', borderRadius: 4 }}><span>E-W</span><span>{gameState.scores?.['E-W'] || 0}</span></div>
            <div style={{ fontSize: 10, color: '#a0d0a0', marginTop: 6 }}>This hand HCP:</div>
            <div className="ac-player-row"><span>N-S</span><span>{gameState.teamPoints?.['N-S'] || 0}</span></div>
            <div className="ac-player-row"><span>E-W</span><span>{gameState.teamPoints?.['E-W'] || 0}</span></div>
            <div style={{ fontSize: 10, color: '#a0d0a0', marginTop: 2 }}>Tricks this hand:</div>
            <div className="ac-player-row"><span>N-S</span><span>{gameState.teamTricks?.['N-S'] || 0}</span></div>
            <div className="ac-player-row"><span>E-W</span><span>{gameState.teamTricks?.['E-W'] || 0}</span></div>

            <h3 style={{ marginTop: 12 }}>Controls</h3>
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
                  {gameState.handNumber >= 6 ? 'End Game' : 'Confirm Hand'}
                </button>
              )}
          </div>
          <a href="/instructions" target="_blank" className="help-link">How to Play</a>
        </div>
      </div>

        {/* Live Tricks + Scores */}
        <div className="ac-panel ac-wide" style={{ marginTop: 12 }}>
          <h3>Tricks & Scores <span style={{ fontWeight: 400, fontSize: 11, color: '#a0d0a0' }}>(live)</span></h3>
          {(gameState.trickHistory?.length > 0 || gameState.currentTrick?.length > 0) ? (
            <div className="ac-trick-table">
              <div className="ac-trick-table-header">
                <span className="ac-tt-trick">Trick</span>
                {trickOrder.map(pos => (
                  <span key={pos} className="ac-tt-card">{POSITION_NAMES[pos]}</span>
                ))}
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
                            {entry.card.rank}{entry.card.suit}
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
                              {entry.card.rank}{entry.card.suit}
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

      {/* Top player (hidden for admin — admin panel below shows the info) */}
      {!(isAdmin && !isSpectator) && (
        <div className="table-seat top">
          <div className="seat-info">{playerAtPos(posOrder[0])?.name || POSITION_NAMES[posOrder[0]]}{playerAtPos(posOrder[0]) && <span className="team-badge">{playerAtPos(posOrder[0]).team}</span>}</div>
          {vacatedAt(posOrder[0]) ? renderVacated(posOrder[0]) : (
            <div className="hand-cards">
              {Array.from({ length: faceDownCount(playerAtPos(posOrder[0])) }).map((_, i) => (
                <span key={i} className="card-back" />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Center area */}
      <div className="table-center">
        <div className="table-felt">
          <div className="table-info">
            {isPlaying && gameState.trumpSuit && <div className="trump-indicator">Trump: {gameState.trumpSuit}</div>}
            {gameState.trumpCard && <div className="trump-card-display"><span className="trump-card-label">Trump card:</span>{renderCard(gameState.trumpCard)}</div>}
            {gameState.trumpRevealed && <div className="trump-revealed">♠ Trump Revealed! ♠</div>}
            <div className="round-info">Hand {gameState.handNumber}/6 · Trick {gameState.trickNumber + 1}/6</div>
            <div className="current-action">
              {gameState.state === 'waiting' && `Waiting — assign positions and start the game`}
              {gameState.state === 'cut' && `Waiting for ${players.find(p => p.isAdmin)?.name || 'admin'} to cut the deck`}
              {isBidding && `${curPlayer?.name} is bidding${isAdmin && vacatedTurnPos ? ' — you bid this seat' : ''}`}
              {isTrump && `${players.find(p => p.position === gameState.declarer?.position)?.name || 'Declarer'} is selecting trump${isAdmin && declarerVacated ? ' — you choose for this seat' : ''}`}
              {isPlaying && `${curPlayer?.name}'s turn${isAdmin && vacatedTurnPos ? ' — you play this seat' : ''}`}
              {gameState.state === 'hand_review' && 'Hand review — waiting for admin to confirm'}
              {gameState.state === 'game_over' && `${gameState.winner} wins!`}
            </div>
            {gameState.contractLevel && <div>Contract: Level {gameState.contractLevel} ({gameState.targetTricks} tricks)</div>}
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
          </div>
        </div>

        {/* Bidding overlay */}
        {isBidding && (
          <div className={`overlay${isMyTurn || (isAdmin && vacatedTurnPos) ? ' active' : ''}`}>
            <h3>Bidding</h3>
            <p>Current bidder: {curPlayer?.name}</p>
            {isMyTurn && (
              <div className="bid-buttons">
                <button onClick={() => sendOnce('bid', { bid: 'pass' })} className="bid-pass">Pass</button>
                {[50,60,70,80,90,100,110,120,130,140,150,160].map(b => (
                  <button key={b} onClick={() => sendOnce('bid', { bid: b })} className="bid-num">{b}</button>
                ))}
              </div>
            )}
            {isAdmin && vacatedTurnPos && (
              <>
                <p style={{ marginTop: 8, color: '#a0d0a0' }}>Bidding for {curPlayer?.name}:</p>
                <div className="bid-buttons">
                  <button onClick={() => sendOnce('admin_play', { position: vacatedTurnPos, card: 'pass' })} className="bid-pass">Pass</button>
                  {[50,60,70,80,90,100,110,120,130,140,150,160].map(b => (
                    <button key={b} onClick={() => sendOnce('admin_play', { position: vacatedTurnPos, card: b })} className="bid-num">{b}</button>
                  ))}
                </div>
              </>
            )}
            <div className="bid-summary">
              {players.map(p => <div key={p.id || p.position}>{p.name}: {p.bid || '—'}</div>)}
            </div>
          </div>
        )}

        {/* Trump selection overlay */}
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
            ) : (
              <p>Waiting for {players.find(p => p.position === gameState.declarer?.position)?.name || 'declarer'} to choose trump...</p>
            )}
          </div>
        )}
      </div>

      {/* Left player */}
      <div className="table-seat left">
        <div className="seat-info">{playerAtPos(posOrder[3])?.name || POSITION_NAMES[posOrder[3]]}{playerAtPos(posOrder[3]) && <span className="team-badge">{playerAtPos(posOrder[3]).team}</span>}</div>
        {vacatedAt(posOrder[3]) ? renderVacated(posOrder[3], true) : (
          <div className="hand-cards vert">
            {Array.from({ length: faceDownCount(playerAtPos(posOrder[3])) }).map((_, i) => (
              <span key={i} className="card-back mini" />
            ))}
          </div>
        )}
      </div>

      {/* Right player */}
      <div className="table-seat right">
        <div className="seat-info">{playerAtPos(posOrder[1])?.name || POSITION_NAMES[posOrder[1]]}{playerAtPos(posOrder[1]) && <span className="team-badge">{playerAtPos(posOrder[1]).team}</span>}</div>
        {vacatedAt(posOrder[1]) ? renderVacated(posOrder[1], true) : (
          <div className="hand-cards vert">
            {Array.from({ length: faceDownCount(playerAtPos(posOrder[1])) }).map((_, i) => (
              <span key={i} className="card-back mini" />
            ))}
          </div>
        )}
      </div>

      {/* Bottom player (YOU) + hand */}
      <div className="table-seat bottom">
        <div className="seat-info">{playerAtPos(posOrder[2])?.name || POSITION_NAMES[posOrder[2]]}</div>
        {vacatedAt(posOrder[2]) ? renderVacated(posOrder[2]) : (
          (isAdmin || isSpectator) ? (
            <div className="spectator-label">{isSpectator ? 'Observing' : 'Admin'} — all hands visible</div>
          ) : (
            <div className="my-hand">
              {(me?.hand || []).map((c, i) => {
                const isTrumpCard = isPlaying && gameState.trumpSuit && c.suit === gameState.trumpSuit && me.hand.length > 4;
                const canPlay = isMyTurn && isPlaying && !isBidding && !isTrump;
                return (
                  <button key={i} className={`hand-card${isTrumpCard ? ' trump' : ''}`}
                    disabled={!canPlay}
                    onClick={() => canPlay && sendOnce('play', { card: { suit: c.suit, rank: c.rank } })}>
                    {renderCard(c)}
                  </button>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Team scores */}
      <div className="team-scores">
        <div className="ts-row header"><span></span><span>Score</span><span>HCP</span></div>
        <div className="ts-row ns"><span>N-S</span><span>{gameState.scores?.['N-S'] || 0}</span><span>{gameState.teamPoints?.['N-S'] || 0}</span></div>
        <div className="ts-row ew"><span>E-W</span><span>{gameState.scores?.['E-W'] || 0}</span><span>{gameState.teamPoints?.['E-W'] || 0}</span></div>
      </div>

      {/* Action buttons */}
      <div className="action-bar">
        {(isPlaying || isBidding || isTrump) && !isSpectator && (
          <>
            {isPlaying && !isDeclarer && !isAdmin && !gameState.trumpRevealed && canAskTrump && (
              <button className="action-btn" onClick={() => sendOnce('ask_trump')}>Ask Trump</button>
            )}
            {isPlaying && isDeclarer && !isAdmin && gameState.trumpCard && canPlayTrump && (
              <button className="action-btn" onClick={() => sendOnce('play_trump')}>Play Trump</button>
            )}
          </>
        )}
      </div>

      {/* Turn indicator */}
      {isMyTurn && isPlaying && !isSpectator && <div className="turn-indicator">Your turn!</div>}

      {/* Admin Panel (collapsible) */}
      {adminPanel}
    </div>
  );
}

export default App;
