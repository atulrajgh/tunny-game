import React, { useState, useEffect, useCallback } from 'react';
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

  const showError = useCallback((msg) => { setError(msg); setTimeout(() => setError(''), 5000); }, []);

  useEffect(() => {
    const s = SOCKET_URL ? io(SOCKET_URL) : io();
    setSocket(s);
    s.on('room_list', (list) => setRoomList(list));
    s.on('error', (e) => showError(e.message));
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
      setScreen('room');
    });
    socket.on('state', (state) => {
      setGameState(state);
      if (state.me) {
        setIsAdmin(state.me.isAdmin);
        setIsSpectator(!!state.me.isSpectator);
        setPlayerId(state.me.id);
      }
      if (state.state === 'cut') {
        setScreen('cut');
      } else if (state.state === 'hand_review') {
        setScreen('review');
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

  // --- Room view ---
  if (gameState.state === 'waiting' || gameState.state === 'cut') {
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
            onClick={() => socket.emit('start_game')}>
            Start Game
          </button>
        )}
        {gameState.state === 'cut' && isAdmin && (
          <button className="start-btn" onClick={() => socket.emit('cut_done')}>Reveal Cut Results</button>
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
            {isAdmin && <button className="start-btn" onClick={() => socket.emit('cut_done')}>Continue</button>}
          </div>
        ) : (
          <p>Waiting for cut results...</p>
        )}
      </div>
    );
  }

  // --- Hand Review ---
  if (gameState.state === 'hand_review' && screen === 'review') {
    const nsPlayers = players.filter(p => p.team === 'N-S');
    const ewPlayers = players.filter(p => p.team === 'E-W');
    return (
      <div className="app review-screen">
        <h2>Hand {gameState.handNumber} Review</h2>
        {error && <div className="toast error">{error}</div>}
        <div className="review-teams">
          <div className="review-team">
            <h3>N-S</h3>
            <div className="team-points">Tricks: {gameState.teamTricks?.['N-S'] || 0} · Points: {(gameState.teamPoints?.['N-S'] || 0).toFixed(1)}</div>
            {nsPlayers.map(p => (
              <div key={p.id} className="review-hand">
                <div className="review-player">{p.name} {p.id === gameState.declarer?.id ? '(Declarer)' : ''}</div>
                <div className="review-cards">
                  {(p.hand || []).map((c, i) => (
                    <span key={i} className={`mini-card ${c.suit === '♥' || c.suit === '♦' ? 'red' : ''}`}>{c.rank}{c.suit}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="review-team">
            <h3>E-W</h3>
            <div className="team-points">Tricks: {gameState.teamTricks?.['E-W'] || 0} · Points: {(gameState.teamPoints?.['E-W'] || 0).toFixed(1)}</div>
            {ewPlayers.map(p => (
              <div key={p.id} className="review-hand">
                <div className="review-player">{p.name} {p.id === gameState.declarer?.id ? '(Declarer)' : ''}</div>
                <div className="review-cards">
                  {(p.hand || []).map((c, i) => (
                    <span key={i} className={`mini-card ${c.suit === '♥' || c.suit === '♦' ? 'red' : ''}`}>{c.rank}{c.suit}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="review-score">
          Running: N-S {gameState.scores?.['N-S'] || 0} · E-W {gameState.scores?.['E-W'] || 0}
        </div>
        {isAdmin && (
          <button className="start-btn" onClick={() => socket.emit('confirm_hand')}>
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
        {isAdmin && <button className="start-btn" onClick={() => socket.emit('reset_game')}>Play Again</button>}
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

  // Build table positions relative to viewer (admin has no position — fixed N/E/S/W)
  const ORDER = ['N', 'E', 'S', 'W'];
  let posOrder = ORDER.slice();
  if (myPos) {
    const myIdx = ORDER.indexOf(myPos);
    const opp = ORDER[(myIdx + 2) % 4];
    posOrder = [opp, ORDER[(myIdx + 3) % 4], myPos, ORDER[(myIdx + 1) % 4]];
  }

  function playerAtPos(pos) { return players.find(p => p.position === pos); }

  function renderCard(c, small) {
    if (!c) return null;
    const isRed = c.suit === '♥' || c.suit === '♦';
    return <span className={`card-face${small ? ' small' : ''}${isRed ? ' red' : ''}`}>{c.rank}{c.suit}</span>;
  }

  return (
    <div className="app game-table">
      {error && <div className="toast error">{error}</div>}
      {timedOut && (
        <div className="timeout-banner">
          {timedOut.playerName} timed out! {isAdmin && <button onClick={() => { setTimedOut(null); socket.emit('admin_play', { targetId: timedOut.playerId }); }}>Take Over</button>}
        </div>
      )}

      {/* Top player */}
      <div className="table-seat top">
        <div className="seat-info">{playerAtPos(posOrder[0])?.name || POSITION_NAMES[posOrder[0]]}{playerAtPos(posOrder[0]) && <span className="team-badge">{playerAtPos(posOrder[0]).team}</span>}</div>
        <div className="hand-cards">
          {playerAtPos(posOrder[0])?.hand?.map((c, i) => (
            <span key={i} className="card-back" />
          ))}
        </div>
        <div className="tricks">{playerAtPos(posOrder[0])?.team && gameState.teamPoints?.[playerAtPos(posOrder[0]).team] > 0 ? `Pts ${gameState.teamPoints[playerAtPos(posOrder[0]).team].toFixed(1)}` : ''}</div>
      </div>

      {/* Center area */}
      <div className="table-center">
        <div className="table-felt">
          <div className="table-info">
            {isPlaying && gameState.trumpSuit && <div className="trump-indicator">Trump: {gameState.trumpSuit}</div>}
            {gameState.trumpCard && <div className="trump-card-display"><span className="trump-card-label">Trump card:</span>{renderCard(gameState.trumpCard)}</div>}
            {gameState.trumpRevealed && <div className="trump-revealed">♠ Trump Revealed! ♠</div>}
            <div className="round-info">Hand {gameState.handNumber}/6 · Trick {gameState.trickNumber + 1}/6</div>
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
          <div className={`overlay${isMyTurn ? ' active' : ''}`}>
            <h3>Bidding</h3>
            <p>Current bidder: {curPlayer?.name}</p>
            {isMyTurn && (
              <div className="bid-buttons">
                <button onClick={() => socket.emit('bid', { bid: 'pass' })} className="bid-pass">Pass</button>
                {[5,6,7,8,9,10,11,12,13,14].map(b => (
                  <button key={b} onClick={() => socket.emit('bid', { bid: b })} className="bid-num">{b}</button>
                ))}
              </div>
            )}
            <div className="bid-summary">
              {players.map(p => <div key={p.id}>{p.name}: {p.bid || '—'}</div>)}
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
                  <button key={i} className="card-btn" onClick={() => socket.emit('choose_trump', { card: { suit: c.suit, rank: c.rank } })}>
                    {renderCard(c)}
                  </button>
                ))}
              </div>
            ) : (
              <p>Waiting for {gameState.declarer?.position || 'declarer'} to choose trump...</p>
            )}
          </div>
        )}
      </div>

      {/* Left player */}
      <div className="table-seat left">
        <div className="seat-info">{playerAtPos(posOrder[3])?.name || POSITION_NAMES[posOrder[3]]}{playerAtPos(posOrder[3]) && <span className="team-badge">{playerAtPos(posOrder[3]).team}</span>}</div>
        <div className="hand-cards vert">
          {playerAtPos(posOrder[3])?.hand?.map((c, i) => (
            <span key={i} className="card-back mini" />
          ))}
        </div>
        <div className="tricks">{playerAtPos(posOrder[3])?.team && gameState.teamPoints?.[playerAtPos(posOrder[3]).team] > 0 ? `Pts ${gameState.teamPoints[playerAtPos(posOrder[3]).team].toFixed(1)}` : ''}</div>
      </div>

      {/* Right player */}
      <div className="table-seat right">
        <div className="seat-info">{playerAtPos(posOrder[1])?.name || POSITION_NAMES[posOrder[1]]}{playerAtPos(posOrder[1]) && <span className="team-badge">{playerAtPos(posOrder[1]).team}</span>}</div>
        <div className="hand-cards vert">
          {playerAtPos(posOrder[1])?.hand?.map((c, i) => (
            <span key={i} className="card-back mini" />
          ))}
        </div>
        <div className="tricks">{playerAtPos(posOrder[1])?.team && gameState.teamPoints?.[playerAtPos(posOrder[1]).team] > 0 ? `Pts ${gameState.teamPoints[playerAtPos(posOrder[1]).team].toFixed(1)}` : ''}</div>
      </div>

      {/* Bottom player (YOU) + hand */}
      <div className="table-seat bottom">
        <div className="seat-info">{playerAtPos(posOrder[2])?.name || POSITION_NAMES[posOrder[2]]}</div>
        {(isAdmin || isSpectator) ? (
          <div className="spectator-label">{isSpectator ? 'Observing' : 'Admin'} — all hands visible</div>
        ) : (
          <div className="my-hand">
            {(me?.hand || []).map((c, i) => {
              const isTrumpCard = isPlaying && gameState.trumpSuit && c.suit === gameState.trumpSuit && me.hand.length > 4;
              const canPlay = isMyTurn && isPlaying && !isBidding && !isTrump;
              return (
                <button key={i} className={`hand-card${isTrumpCard ? ' trump' : ''}`}
                  disabled={!canPlay}
                  onClick={() => canPlay && socket.emit('play', { card: { suit: c.suit, rank: c.rank } })}>
                  {renderCard(c)}
                </button>
              );
            })}
          </div>
        )}
        <div className="tricks">{me?.team && gameState.teamPoints?.[me.team] > 0 ? `Pts ${gameState.teamPoints[me.team].toFixed(1)}` : ''}</div>
      </div>

      {/* Action buttons */}
      {isPlaying && !isSpectator && (
        <div className="action-bar">
          {isPlaying && !isDeclarer && !gameState.trumpRevealed && (
            <button className="action-btn" onClick={() => socket.emit('ask_trump')}>Ask Trump</button>
          )}
          {isPlaying && isDeclarer && gameState.trumpCard && (
            <button className="action-btn" onClick={() => socket.emit('play_trump')}>Play Trump</button>
          )}
          {isAdmin && (
            <button className="action-btn reset" onClick={() => socket.emit('reset_game')}>Reset Game</button>
          )}
        </div>
      )}

      {/* Turn indicator */}
      {isMyTurn && isPlaying && !isSpectator && <div className="turn-indicator">Your turn!</div>}
    </div>
  );
}

export default App;
