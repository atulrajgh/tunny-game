import React, { useState, useEffect, useCallback, useRef } from 'react';
import io from 'socket.io-client';
import './index.css';
import UIViewer from './UIViewer';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL;

const POSITION_NAMES = { N: 'North', S: 'South', E: 'East', W: 'West' };

function handHCPRequirement(bid) {
  return bid + 100;
}

function App() {
  if (window.location.pathname === '/ui') {
    return <UIViewer />;
  }

  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(true);
  const [gameState, setGameState] = useState(null);
  const [screen, setScreen] = useState('login');
  const [playerId, setPlayerId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const [name, setName] = useState(localStorage.getItem('tunny_name') || '');
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(null);
  const [incBid, setIncBid] = useState(50);
  const actionLockRef = useRef(false);
  const joinedRef = useRef(false);
  const [version, setVersion] = useState('');

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
    // Fires on initial connect and every transport-level reconnect. Only re-emits the
    // saved token mid-session (after the user already joined this page) so the seat
    // re-binds instead of being dropped. A fresh page load still shows the login
    // screen so the name can be changed.
    s.on('connect', () => {
      setSocketConnected(true);
      const savedName = localStorage.getItem('tunny_name');
      const savedId = localStorage.getItem('tunny_id');
      if (joinedRef.current && savedId && savedName) {
        s.emit('create_room', { playerName: savedName, playerId: savedId });
      }
    });
    s.on('disconnect', () => setSocketConnected(false));
    s.on('connect_error', () => setSocketConnected(false));
    s.on('room_list', () => {});
    s.on('error', (e) => { showError(e.message); unlockAction(); });
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
      joinedRef.current = true;
      if (data.playerId) localStorage.setItem('tunny_id', data.playerId);
      setPlayerId(data.playerId);
      setIsAdmin(data.isAdmin);
      setIsSpectator(!!data.isSpectator);
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
      setScreen(state.state === 'hand_review' ? 'review' : 'game');
    });
    socket.on('cut_start', () => { setScreen('game'); });
    socket.on('game_over', () => setScreen('game'));
    socket.on('next_hand', () => setScreen('game'));
    socket.on('game_reset', () => { joinedRef.current = false; setScreen('login'); setGameState(null); });
    socket.on('player_timed_out', (d) => setTimedOut(d));
    socket.on('hand_end', () => setScreen('review'));
    socket.on('trump_selection', () => setScreen('game'));
    socket.on('game_playing', () => setScreen('game'));
    socket.on('trump_revealed', () => { /* state update handles it */ });
    socket.on('redeal_pending', () => { setScreen('game'); setTimedOut(null); unlockAction(); });
    socket.on('redealed', (d) => { unlockAction(); showError(`Redeal done${d && d.dealer ? ' — new dealer ' + d.dealer : ''}`); });
    socket.on('seats_assigned', (d) => showError(`Seats assigned — ${(d && d.summary) || ''}`));
    socket.on('player_joined', () => {});
    socket.on('room_closed', (data) => {
      joinedRef.current = false;
      setGameState(null);
      setScreen('login');
      showError(data.message);
    });
    socket.on('player_left', (data) => {
      if (data.reconnecting) showError(`${data.playerName} is reconnecting…`);
      else showError(`${data.playerName} dropped out`);
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
      setIncBid(hb === 0 ? 50 : Math.min(hb + 10, 200));
    }
  }, [gameState?.state, gameState?.highestBid]);

  useEffect(() => {
    fetch('/settings.json')
      .then(r => r.json())
      .then(s => { if (s && s.version) setVersion(s.version); })
      .catch(() => {});
  }, []);

  const placeMyBid = () => {
    sendOnce('bid', { bid: incBid });
  };

  const joinGame = () => {
    if (!name) return showError('Enter your name');
    localStorage.setItem('tunny_name', name);
    socket.emit('create_room', { playerName: name, playerId: localStorage.getItem('tunny_id') || undefined });
  };

  // --- Login ---
  if (screen === 'login') {
    return (
      <div className="app login-screen">
        <h1 className="title">♠ TUNNY ♥</h1>
        <a href="/instructions" target="_blank" className="help-link" style={{ marginBottom: 12 }}>How to Play</a>
        {!socketConnected && <div className="reconnect-banner">Connection lost — reconnecting…</div>}
        {error && <div className="toast error">{error}</div>}
        <div className="login-box">
          <input placeholder="Your Name" value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && joinGame()} />
          <button onClick={joinGame}>Join</button>
        </div>
        <div className="credit">This site is brought to you courtesy of <a href="https://render.com/" target="_blank" rel="noreferrer">https://render.com/</a></div>
        {version && <div className="version">Version {version}</div>}
      </div>
    );
  }

  if (!gameState) {
    return <div className="app"><div className="loading">Connecting...</div></div>;
  }

  const { me } = gameState;
  const myPos = me?.position;
  const players = gameState.players || [];
  const adminName = gameState.admin?.name || 'Admin';

  // --- Room view removed: single global table, non-admin waiting players see the game table ---

  // --- Hand Review ---
  if (gameState.state === 'hand_review' && screen === 'review') {
    const posOrder = ['N', 'S', 'E', 'W'];
    const rows = buildTrickRows(gameState.trickHistory || []);
    return (
      <div className="app review-screen">
        <h2 className="review-title">Hand {gameState.handNumber} Review{gameState.highestBid ? <> · Highest Bid: {gameState.highestBid} ({handHCPRequirement(gameState.highestBid)} HCP)</> : ''}</h2>
        {(error || !isAdmin) && (
          <div className="message-bar">
            {error && <span>{error}</span>}
            {!isAdmin && <span>Waiting for admin to confirm...</span>}
          </div>
        )}
        <div className="ac-trick-table review-table">
          <div className="ac-trick-table-header">
            <span className="ac-tt-trick">Trick</span>
            <span className="ac-tt-pts">Team Totals</span>
            {posOrder.map(pos => {
              const p = players.find(x => x.position === pos);
              return (
                <span key={pos} className="ac-tt-card">{p?.name || POSITION_NAMES[pos]}{gameState.declarer?.position === pos && gameState.trumpSuit ? <span className={`trump-suit ${gameState.trumpSuit === '♥' || gameState.trumpSuit === '♦' ? 'red' : ''}`}>{gameState.trumpSuit}</span> : null}</span>
              );
            })}
          </div>
          {rows.map((r, i) => (
            <div key={i} className={`ac-trick-table-row${r.winner ? ` win-${r.winner === 'N-S' ? 'ns' : 'ew'}` : ''}`}>
              <span className="ac-tt-trick">{i + 1}</span>
              <span className="ac-tt-pts team-totals">
                <span className="team-total">{r.winner === 'N-S' ? `+${r.ns}` : `+${r.ew}`}</span>
              </span>
              {posOrder.map(pos => {
                const isWinner = r.winnerPosition === pos;
                return (
                  <span key={pos} className="ac-tt-card">
                    {miniCard(r.cards[pos], isWinner) || <span className="ac-empty" style={{ padding: 0 }}>—</span>}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        {isAdmin && (
          <button className="start-btn" onClick={() => sendOnce('confirm_hand')}>
            Confirm & Next Hand
          </button>
        )}
        <div className="credit">This site is brought to you courtesy of <a href="https://render.com/" target="_blank" rel="noreferrer">https://render.com/</a></div>
        {version && <div className="version">Version {version}</div>}
      </div>
    );
  }

  // --- Game over ---
  if (gameState.state === 'game_over') {
    const winnerTeam = gameState.winner;
    const winNames = players.filter(p => p.team === winnerTeam).map(p => p.name).join(' & ');
    return (
      <div className="app gameover-screen">
        <h2>Game Over</h2>
        <div className="winner-banner">{winNames} Win</div>
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
          <div className="login-box" style={{ margin: '16px auto 0' }}>
            <input placeholder="Your Name" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinGame()} />
            <button onClick={joinGame}>Join</button>
          </div>
          <div className="credit">This site is brought to you courtesy of <a href="https://render.com/" target="_blank" rel="noreferrer">https://render.com/</a></div>
          {version && <div className="version">Version {version}</div>}
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
  const vacatedTurnPos = curPlayer && curPlayer.id === null ? curPlayer.position : null;
  const vacatedPlayer = vacatedTurnPos ? vacatedAt(vacatedTurnPos) : null;
  const declarerVacated = gameState.declarer ? vacatedAt(gameState.declarer.position) : null;
  const timedOutHand = gameState.timedOutHand;
  const timedOutTurn = isAdmin && timedOutHand && curPlayer && curPlayer.id === timedOutHand.playerId;
  const timedOutDeclarer = isAdmin && timedOutHand && gameState.declarer && gameState.declarer.id === timedOutHand.playerId;
const seatedCount = Object.keys(gameState.positions || {}).length;
  const humanSeated = (gameState.players || []).filter(p => !p.isBot).length;
  const botCount = (gameState.players || []).filter(p => p.isBot).length + (gameState.spectators || []).filter(s => s.isBot).length;
  const tableFull = seatedCount === 4;
  // Anyone SITTING at a seat (plus the host admin) can advance waiting/cut/redeal.
  const canStartFlow = !!me && !me.isBot && (me.position || me.isAdmin);
  // Assign Seats is admin-only: seats unseated humans, then existing bots; the admin
  // fills a seat only when no humans are in the gallery.
  const unseatedHumans = (gameState.players || []).filter(p => !p.isBot && !p.position).length;
  const unseatedBots = (gameState.spectators || []).filter(s => s.isBot && !s.position).length;
  const adminUnseated = !!me && me.isAdmin && !me.position;
  // The gallery pool = unseated players + unseated spectator bots awaiting a seat.
  // Assign Seats only renders once the pool has at least 3 candidates so a single
  // click meaningfully fills the table.
  const galleryPool = unseatedHumans + unseatedBots;
  const showAssignSeats = galleryPool >= 3;
  const assignSeatsEnabled = !!me && me.isAdmin && seatedCount < 4 &&
    (unseatedHumans > 0 || unseatedBots > 0 || adminUnseated);

  // The current "who is acting" line, folded into the unified message bar.
  const currentActionText = [
    gameState.state === 'waiting' && (tableFull
      ? (isAdmin ? 'Waiting — the table is full; start the game' : `${seatedCount}/4 seated — any seated player can start`)
      : `Only ${seatedCount}/4 seated — ${showAssignSeats ? 'add bots or assign seats' : 'add bots to fill the table'}`),
    gameState.state === 'cut' && (isAdmin ? 'Waiting — determine the dealer' : 'Cut complete — any seated player can determine the dealer'),
    isBidding && `${curPlayer?.name || 'Someone'} is bidding${isAdmin && vacatedTurnPos ? ' — you bid this seat' : ''}`,
    isTrump && `${players.find(p => p.position === gameState.declarer?.position)?.name || 'Declarer'} is selecting trump${isAdmin && declarerVacated ? ' — you choose for this seat' : ''}`,
    gameState.state === 'redeal_pending' && null,
    isPlaying && `${curPlayer?.name || 'Someone'}'s turn${isAdmin && vacatedTurnPos ? ' — you play this seat' : ''}`,
    gameState.state === 'hand_review' && 'Hand review — waiting for admin to confirm',
    gameState.state === 'game_over' && `${gameState.winner} wins!`
  ].filter(Boolean).join(' · ');

  // Trump action rules: hidden by default — only on your turn when you can't follow the led suit
  const ledSuit = gameState.currentTrick?.[0]?.card?.suit || null;
  const iHoldLeadSuit = !!ledSuit && (me?.hand || []).some(c => c.suit === ledSuit);
  const canTrumpAction = isMyTurn && !!ledSuit && !iHoldLeadSuit;
  const isLastTrick = gameState.trickNumber === 5;

  // Who set the trump + contract progress ("Need X · made Y" HCP)
  const declarerName = gameState.declarer
    ? (playerAtPos(gameState.declarer.position)?.name || POSITION_NAMES[gameState.declarer.position])
    : null;
  const declarerTeamPos = gameState.declarer ? (['N', 'S'].includes(gameState.declarer.position) ? 'N-S' : 'E-W') : null;
  const contractNeed = isPlaying && gameState.highestBid ? handHCPRequirement(gameState.highestBid) : null;

  // A completed trick stays on display until the first card of the next trick is played:
  // while currentTrick is empty during play, fall back to the last trickHistory entry.
  const lastTrickEntry = (!gameState.currentTrick?.length && gameState.trickHistory?.length)
    ? gameState.trickHistory[gameState.trickHistory.length - 1] : null;
  const shownTrick = gameState.currentTrick?.length > 0
    ? gameState.currentTrick
    : (lastTrickEntry
      ? lastTrickEntry.cards.map(c => ({ playerId: c.playerId, playerName: c.playerName, position: c.position, card: { suit: c.card.suit, rank: c.card.rank } }))
      : []);

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
    return (
      <span className={`card-face${small ? ' small' : ''}${isRed ? ' red' : ''}`}>
        <span className="card-suit-top">{c.suit}</span>
        <span className="card-rank-bottom">{c.rank}</span>
      </span>
    );
  }

  function miniCard(c, isWinner) {
    if (!c) return null;
    const isRed = c.suit === '♥' || c.suit === '♦';
    return (
      <span className={`mini-card${isWinner ? ' trick-winner' : ''} ${isRed ? 'red' : ''}`}>
        {c.rank}<span className="suit-mark">{c.suit}</span>
      </span>
    );
  }

  function buildTrickRows(trickHistory) {
    let nsRunning = 0;
    let ewRunning = 0;
    return (trickHistory || []).map(t => {
      const cardAt = {};
      for (const c of t.cards) cardAt[c.position] = c.card;
      const winValue = t.winnerPoints != null
        ? t.winnerPoints
        : (t.teamPoints?.['N-S'] || 0) + (t.teamPoints?.['E-W'] || 0);
      if (t.winnerTeam === 'N-S') nsRunning += winValue;
      else ewRunning += winValue;
      return {
        t,
        cards: cardAt,
        winner: t.winnerTeam,
        winnerPosition: t.winnerPosition,
        ns: nsRunning,
        ew: ewRunning
      };
    });
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

  const stuckSeat = gameState.stuckSeat;
  const log = gameState.lastHandLog;
  let adminPanel = null;
  if (isAdmin && !isSpectator) {
    const unseated = players.filter(p => !p.position);
    const botSpectators = (gameState.spectators || []).filter(s => s.isBot);
    const humanSpectators = (gameState.spectators || []).filter(s => !s.isBot);
    const trickOrder = ['N', 'S', 'E', 'W'];
    const hostSeated = !!myPos;
    const isBotAt = (pos) => {
      const pid = gameState.positions?.[pos];
      const bp = players.find(x => x.id === pid);
      return !!bp && bp.isBot;
    };
    const seatOpenFor = (pos) => !gameState.positions?.[pos] || isBotAt(pos);
    const botCount = players.filter(p => p.isBot).length + (gameState.spectators || []).filter(s => s.isBot).length;
    adminPanel = (
      <div className="admin-panel">
        <div className="ac-grid">
          {/* Left: Host + Gallery + Table Seats */}
          <div className="ac-panel">
            <h3>Host</h3>
            <div className="ac-player-row">
              <span className="ac-name">You <span className="host-tag">HOST</span></span>
              <span className="ac-team">{hostSeated ? (gameState.me?.team || '—') : '—'}</span>
              <div className="ac-actions">
                {hostSeated ? (
                  <button className="ac-btn gray" onClick={() => sendOnce('admin_stand')}>Leave Seat</button>
                ) : (
                  ['N','S','E','W'].filter(seatOpenFor).map(pos => (
                    <button key={pos} className="ac-btn green pos"
                      onClick={() => sendOnce('admin_sit', { position: pos })}>
                      {pos}
                    </button>
                  ))
                )}
              </div>
            </div>
            <h3 style={{ marginTop: 12 }}>Table</h3>
            {['N','S','E','W'].map(pos => {
              const pid = gameState.positions?.[pos];
              const p = players.find(x => x.id === pid);
              return (
                <div key={pos} className="ac-player-row">
                  <span style={{ fontWeight: 700, width: 20 }}>{pos}</span>
                  {p ? (
                    <>
                      <span className="ac-name">{p.name}{p.isBot ? <span className="bot-tag">BOT</span> : null}{p.online === false ? <span className="offline-tag">reconnecting</span> : null}</span>
                      <span className="ac-team">{p.team || '—'}</span>
                      <div className="ac-actions">
                        {isAdmin && p.id !== playerId && (
                          <button className="ac-btn red" onClick={() => sendOnce('kick_player', { targetId: p.id })}>✕</button>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="ac-empty">— empty —</span>
                  )}
                </div>
              );
            })}
            <h3 style={{ marginTop: 12 }}>Gallery ({unseated.length + botSpectators.length})</h3>
            {unseated.length === 0 && botSpectators.length === 0 ? (
              <div className="ac-empty">No waiting players</div>
            ) : (
              <>
                {unseated.map(p => (
                  <div key={p.id} className="ac-player-row">
                    <span className="ac-name">{p.name}{p.isBot ? <span className="bot-tag">BOT</span> : null}</span>
                    <div className="ac-actions">
                      {['N','S','E','W'].filter(seatOpenFor).map(pos => (
                        <button key={pos} className="ac-btn green pos"
                          onClick={() => sendOnce('assign_position', { playerId: p.id, position: pos })}>
                          {pos}
                        </button>
                      ))}
                      {p.id !== playerId && (
                        <button className="ac-btn red pos" onClick={() => sendOnce('kick_player', { targetId: p.id })}>✕</button>
                      )}
                    </div>
                  </div>
                ))}
                {botSpectators.map(s => (
                  <div key={s.id} className="ac-player-row">
                    <span className="ac-name">{s.name}<span className="bot-tag">BOT</span></span>
                    <div className="ac-actions">
                      {['N','S','E','W'].filter(pos => !gameState.positions?.[pos]).map(pos => (
                        <button key={pos} className="ac-btn green pos"
                          onClick={() => sendOnce('promote_to_player', { spectatorId: s.id, position: pos })}>
                          {pos}
                        </button>
                      ))}
                      <button className="ac-btn red pos" onClick={() => sendOnce('remove_bot', { botId: s.id })}>✕</button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {humanSpectators.length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>Spectators</h3>
                {humanSpectators.map(s => (
                  <div key={s.id} className="ac-player-row">
                    <span className="ac-name">{s.name}</span>
                    <div className="ac-actions">
                      {['N','S','E','W'].filter(seatOpenFor).map(pos => (
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
            <h3 style={{ marginTop: 12 }}>Bots ({botCount}/3)</h3>
            <div className="ac-player-row">
              <button className="ac-btn green add-bot" disabled={botCount >= 3}
                onClick={() => sendOnce('add_bot')}>
                Add Bot
              </button>
            </div>
          </div>

          {/* Center: Game State + Bids + Current Trick */}
          <div className="ac-panel">
            <h3>Game State</h3>
            <div className="ac-state">
              <div className="ac-state-item"><span className="ac-label">Hand</span><span className="ac-value">{gameState.handNumber}</span></div>
              <div className="ac-state-item"><span className="ac-label">Trick</span><span className="ac-value">{gameState.trickNumber + 1}/6</span></div>
              <div className="ac-state-item"><span className="ac-label">State</span><span className="ac-value small">{gameState.state}</span></div>
              {gameState.dealer && <div className="ac-state-item"><span className="ac-label">Dealer</span><span className="ac-value small">{players.find(p => p.id === gameState.dealer.id)?.name || gameState.dealer.position}</span></div>}
              {gameState.declarer && <div className="ac-state-item"><span className="ac-label">Declarer</span><span className="ac-value small">{players.find(p => p.id === gameState.declarer.id)?.name || gameState.declarer.position}</span></div>}
              {gameState.highestBid && <div className="ac-state-item"><span className="ac-label">Bid</span><span className="ac-value">{gameState.highestBid}</span></div>}
              {gameState.trumpSuit && <div className="ac-state-item"><span className="ac-label">Trump</span><span className="ac-value">{gameState.trumpSuit}</span></div>}
            </div>

          </div>

          {/* Right: Controls */}
          <div className="ac-panel">
            <h3>Controls</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
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
            <div className="ac-trick-table ac-review-style">
              <div className="ac-trick-table-header">
                <span className="ac-tt-trick">Trick</span>
                <span className="ac-tt-pts">Team Totals</span>
                {trickOrder.map(pos => {
                  const pn = players.find(x => x.position === pos);
                  return (
                    <span key={pos} className="ac-tt-card">{pn?.name || POSITION_NAMES[pos]}{gameState.declarer?.position === pos && gameState.trumpSuit ? <span className={`trump-suit ${gameState.trumpSuit === '♥' || gameState.trumpSuit === '♦' ? 'red' : ''}`}>{gameState.trumpSuit}</span> : null}</span>
                  );
                })}
              </div>
              {gameState.currentTrick?.length > 0 && (
                <div className="ac-trick-table-row current">
                  <span className="ac-tt-trick">{gameState.trickNumber + 1}*</span>
                  <span className="ac-tt-pts team-totals">
                    <span className="team-total pending">…</span>
                  </span>
                  {trickOrder.map(pos => {
                    const entry = gameState.currentTrick.find(t => t.position === pos);
                    return (
                      <span key={pos} className="ac-tt-card">
                        {miniCard(entry?.card) || <span className="ac-empty" style={{ padding: 0 }}>·</span>}
                      </span>
                    );
                  })}
                </div>
              )}
              {buildTrickRows(gameState.trickHistory).map((r, i) => {
                const winnerIdx = r.t.cards.findIndex(c => c.position === r.winnerPosition);
                return (
                  <div key={i} className={`ac-trick-table-row${r.winner === 'N-S' ? ' win-ns' : ' win-ew'}`}>
                    <span className="ac-tt-trick">{r.t.trickNumber + 1}</span>
                    <span className="ac-tt-pts team-totals">
                      <span className="team-total">{r.winner === 'N-S' ? `+${r.ns}` : `+${r.ew}`}</span>
                    </span>
                    {trickOrder.map(pos => {
                      const entry = r.t.cards.find(c => c.position === pos);
                      const isWinner = entry && winnerIdx !== -1 && r.t.cards[winnerIdx].position === pos;
                      return (
                        <span key={pos} className="ac-tt-card">
                          {miniCard(entry?.card, isWinner) || <span className="ac-empty" style={{ padding: 0 }}>—</span>}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ac-empty">No tricks yet — waiting for play to start</div>
          )}
        </div>

        {/* Hand Log — the complete trace of the current/latest hand */}
        <div className="ac-panel ac-wide" style={{ marginTop: 12 }}>
          <h3>Hand Log <span style={{ fontWeight: 400, fontSize: 11, color: '#a0d0a0' }}>(debug)</span></h3>
          {log ? (
            <>
              <div className="hl-summary">
                Hand {log.handNumber} · {log.declarer} declared {log.bid || '—'}
                {log.trumpSuit ? ` · trump ${log.trumpSuit}` : ' · trump not chosen'}
                {log.reservedTrump ? ` (reserved ${log.reservedTrump})` : ''}
                {log.result ? ` · made ${log.result.declarerHCP}/${log.result.required} HCP` : ' · in progress'}
              </div>
              {log.seats && (
                <div className="hl-seats">
                  {Object.entries(log.seats).map(([pos, s]) => (
                    <span key={pos} className="hl-seat">
                      {POSITION_NAMES[pos] || pos} ({s.name || '?'}) bid {s.bid === undefined ? '—' : (s.bid === 'pass' ? 'pass' : s.bid)} · {s.handSize} cards
                    </span>
                  ))}
                </div>
              )}
              <div className="hl-plays">
                {log.plays.length === 0
                  ? <div className="ac-empty">No cards played yet</div>
                  : log.plays.map((p, i) => (
                      <div key={i} className={'hl-play' + (p.kind !== 'card' ? ' special' : '')}>
                        <span className="hl-trick">T{p.trick}</span>
                        <span className="hl-pos">{p.position}</span>
                        <span className="hl-card">{p.card}</span>
                        <span className="hl-note">
                          {p.kind === 'reserved_trump'
                            ? 'reserved trump played'
                            : p.kind === 'ask_trump'
                            ? 'revealed trump'
                            : `${p.handAfter} left`}
                        </span>
                      </div>
                    ))}
              </div>
              {(log.integrity?.length > 0 || log.result) && (
                <div className="hl-events">
                  {log.integrity?.map((e, i) => (
                    <div key={i} className="hl-event">
                      {e.reason} · missing {e.missingCards}
                      {(e.repairs || []).map((r, j) => (
                        <span key={j} className="hl-repair"> → {r.position} got back {r.card}</span>
                      ))}
                      {e.unrecovered > 0 && <span className="hl-bad"> · {e.unrecovered} unresolved</span>}
                    </div>
                  ))}
                  {log.result && (
                    <div className="hl-event">
                      {log.result.tricks.length} tricks
                      {log.result.declarerTeam} {log.result.made ? 'made' : 'failed'} it
                    </div>
                  )}
                </div>
              )}
              {gameState.handIntegrity && !gameState.handIntegrity.ok && (
                <div className="hl-event hl-bad">
                  Card audit not clean: {gameState.handIntegrity.shortSeats.map(s => `${s.position} has ${s.counted}/${s.expected}`).join(', ') || 'see log'}
                </div>
              )}
            </>
          ) : (
            <div className="ac-empty">No hand log yet</div>
          )}
        </div>
      </div>
    );
  }

  const messageBar = currentActionText || !socketConnected || error || gameState.redealPending || timedOut || stuckSeat || (isMyTurn && isPlaying && !isSpectator) ? (
    <div className={'message-bar' + (error ? ' error' : '')}>
      {!socketConnected && <span>Connection lost — reconnecting…</span>}
      {error && <span>{error}</span>}
      {stuckSeat && (
        <span className="stuck-msg">
          {stuckSeat.name} has no cards left to play — the hand cannot continue. Admin: end this hand and redeal.
        </span>
      )}
      {gameState.redealPending && (
        <span className="redeal-msg">
          {gameState.redealPending.reason}
          {gameState.redealCount > 0 && <span className="redeal-count"> ({gameState.redealCount} redeal{gameState.redealCount > 1 ? 's' : ''} so far)</span>}
          <button className="action-btn" disabled={!canStartFlow} onClick={() => sendOnce('redeal')}>Redeal</button>
        </span>
      )}
      {gameState.state === 'waiting' && (
        <span className="flow-msg">
          {showAssignSeats && (
            <>
              <button className="action-btn" disabled={!assignSeatsEnabled}
                onClick={() => sendOnce('assign_seats')}>Assign Seats</button>
              {!isAdmin && <span className="flow-hint"> (admin only)</span>}
            </>
          )}
          {!tableFull ? (
            botCount < 3 && (
              <>
                <button className="action-btn" disabled={!canStartFlow}
                  onClick={() => sendOnce('add_bot')}>Add Bots</button>
                {!canStartFlow && <span className="flow-hint"> (seated players only)</span>}
              </>
            )
          ) : (
            <>
              <button className="action-btn" disabled={!canStartFlow || humanSeated < 1}
                onClick={() => sendOnce('start_game')}>Start Game</button>
              {!canStartFlow && <span className="flow-hint"> (seated players only)</span>}
            </>
          )}
        </span>
      )}
      {gameState.state === 'cut' && (
        <span className="flow-msg">
          <button className="action-btn" disabled={!canStartFlow}
            onClick={() => sendOnce('cut_done')}>Determine Dealer</button>
          {!canStartFlow && <span className="flow-hint"> (seated players only)</span>}
        </span>
      )}
      {timedOut && (
        <span className="timeout-msg">
          {timedOut.playerId ? `${timedOut.playerName} timed out!` : `${timedOut.playerName}'s seat needs you!`}
          {isAdmin && timedOut.playerId && (
            <button onClick={() => { setTimedOut(null); sendOnce('admin_play', { targetId: timedOut.playerId }); }}>Take Over</button>
          )}
          {isAdmin && !timedOut.playerId && <span> — play their seat below</span>}
        </span>
      )}
      {currentActionText && <span className="current-action-msg">{currentActionText}</span>}
      {isMyTurn && isPlaying && !isSpectator && <span className="your-turn-msg">Your turn!</span>}
    </div>
  ) : null;

  return (
    <div className="app game-table">
      {/* Top: current state message + scores */}
      <div className="state-bar">
        <div className="team-scores">
          <div className="ts-row header"><span></span><span>Score</span><span>HCP</span></div>
          <div className="ts-row ns"><span>N-S</span><span>{gameState.scores?.['N-S'] || 0}</span><span>{gameState.teamPoints?.['N-S'] || 0}</span></div>
          <div className="ts-row ew"><span>E-W</span><span>{gameState.scores?.['E-W'] || 0}</span><span>{gameState.teamPoints?.['E-W'] || 0}</span></div>
          <a href="/instructions" target="_blank" className="help-link">How to Play</a>
        </div>
        <div className="state-info">
          <div className="round-info">Hand {gameState.handNumber} · Trick {gameState.trickNumber + 1}/6</div>
          <div className="state-details">
            {isPlaying && declarerName && (
              <div className="trump-indicator">
                {gameState.trumpSuit ? `Trump: ${gameState.trumpSuit} · set by ${declarerName}` : `Trump set by ${declarerName}`}
              </div>
            )}
            {contractNeed && (
              <div className="contract-progress">Need {contractNeed} HCP · made {gameState.teamPoints?.[declarerTeamPos] || 0}</div>
            )}
            {gameState.trumpCard && <div className="trump-card-display"><span className="trump-card-label">Trump card:</span>{renderCard(gameState.trumpCard)}</div>}
            {gameState.trumpRevealed && <div className="trump-revealed">♠ Trump Revealed! ♠</div>}
          </div>
        </div>
        {isPlaying && shownTrick.length > 0 && (
          <div className="current-trick">
            {shownTrick.map((t, i) => (
              <div key={i} className={`trick-entry${!gameState.currentTrick?.length && t.position === lastTrickEntry?.winnerPosition ? ' won' : ''}`}>
                <span>{t.playerName}</span>
                {t.card ? renderCard(t.card) : <span className="card-back tiny" />}
              </div>
            ))}
          </div>
        )}
        {gameState.state === 'cut' && (
          <div className="current-trick cut-card-area">
            {(gameState.cutCards || []).length > 0 ? (
              <div className="cut-cards">
                {gameState.cutCards.map((c, i) => (
                  <div key={i} className="cut-card">
                    <span className="cut-card-label">{c.name}</span>
                    {c.card ? renderCard(c.card) : <span className="cut-card-pending">Cutting…</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="cut-card">
                {me?.cutCard ? renderCard(me.cutCard) : <span className="cut-card-pending">Cutting…</span>}
                <span className="cut-card-label">Your card</span>
              </div>
            )}
          </div>
        )}
      </div>

{/* Bidding overlay — visible to everyone during bidding; controls enabled only for the current bidder */}
  {isBidding && (
    <div className="overlay bidding-top active">
      <h3>Bidding</h3>
      {isMyTurn || (isAdmin && (vacatedTurnPos || timedOutTurn)) ? (
        <>
          {isAdmin && (vacatedPlayer || timedOutTurn) && (
            <p style={{ marginTop: 8, color: '#a0d0a0' }}>Bidding for {curPlayer?.name}:</p>
          )}
          {isMyTurn && (
            <div className="bid-buttons">
              <button onClick={() => sendOnce('bid', { bid: 'pass' })} className="bid-pass">Pass</button>
              <div className="bid-stepper">
                <button onClick={() => setIncBid(v => Math.min(v + 10, 200))} className="bid-arrow up" aria-label="Increase bid">▲</button>
                <span className="bid-hcp">{handHCPRequirement(incBid)}</span>
                <button onClick={() => setIncBid(v => Math.max(Math.max(50, (highestBid || 0) + 10), v - 10))} className="bid-arrow down" aria-label="Decrease bid">▼</button>
              </div>
              <button onClick={placeMyBid} className="bid-inc">{incBid}</button>
            </div>
          )}
          {isAdmin && (vacatedPlayer || timedOutTurn) && (
            <div className="bid-buttons">
              {vacatedPlayer && (
                <div className="bid-buttons admin">
                  <div className="bid-stepper">
                    <button onClick={() => setIncBid(v => Math.min(v + 10, 200))} className="bid-arrow up" aria-label="Increase bid">▲</button>
                    <span className="bid-hcp">{handHCPRequirement(incBid)}</span>
                    <button onClick={() => setIncBid(v => Math.max(Math.max(50, (highestBid || 0) + 10), v - 10))} className="bid-arrow down" aria-label="Decrease bid">▼</button>
                  </div>
                  <button onClick={() => sendOnce('admin_play', { position: vacatedPlayer.position, card: incBid })} className="bid-inc">{incBid}</button>
                </div>
              )}
              {timedOutTurn && (
                <div className="bid-buttons admin">
                  <div className="bid-stepper">
                    <button onClick={() => setIncBid(v => Math.min(v + 10, 200))} className="bid-arrow up" aria-label="Increase bid">▲</button>
                    <span className="bid-hcp">{handHCPRequirement(incBid)}</span>
                    <button onClick={() => setIncBid(v => Math.max(Math.max(50, (highestBid || 0) + 10), v - 10))} className="bid-arrow down" aria-label="Decrease bid">▼</button>
                  </div>
                  <button onClick={() => { setTimedOut(null); sendOnce('admin_play', { targetId: timedOutHand.playerId, card: incBid }); }} className="bid-inc">{incBid}</button>
                </div>
              )}
              <button onClick={() => {
                const payload = vacatedPlayer
                  ? { position: vacatedPlayer.position, card: 'pass' }
                  : { targetId: timedOutHand.playerId, card: 'pass' };
                setTimedOut(null);
                sendOnce('admin_play', payload);
              }} className="bid-pass">Pass</button>
            </div>
          )}
        </>
      ) : (
        <div className="bid-buttons">
          <button className="bid-pass" disabled>Pass</button>
          <div className="bid-stepper">
            <button className="bid-arrow up" disabled aria-label="Increase bid">▲</button>
            <span className="bid-hcp">{handHCPRequirement(incBid)}</span>
            <button className="bid-arrow down" disabled aria-label="Decrease bid">▼</button>
          </div>
          <button className="bid-inc" disabled>{incBid}</button>
        </div>
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
                  <span className="dummy-name">{p?.name || POSITION_NAMES[pos]}{p?.isBot ? <span className="bot-tag">BOT</span> : null}{p && p.online === false ? <span className="offline-tag">reconnecting</span> : null}</span>
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

      {/* Unified message bar (your-turn spot) */}
      {messageBar}

      {/* My hand */}
      <div className="my-area">
        {timedOutHand ? renderTimedOut() : (
          vacatedAt(posOrder[2]) ? renderVacated(posOrder[2]) : (
            (isAdmin && !isSpectator && !myPos) ? (
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
            {isPlaying && !isDeclarer && myPos && !gameState.trumpRevealed && canTrumpAction && (
              <button className="action-btn" onClick={() => sendOnce('ask_trump')}>Ask Trump</button>
            )}
            {isPlaying && isDeclarer && myPos && !gameState.trumpRevealed && gameState.trumpCard && isMyTurn &&
              (isLastTrick || canTrumpAction || (me?.hand || []).length === 0) && (
              <button className="action-btn" onClick={() => sendOnce('play_trump')}>Play Trump</button>
            )}
          </>
        )}
      </div>

      {/* Admin Panel (collapsible) */}
      {adminPanel}
      {version && <div className="version">Version {version}</div>}
    </div>
  );
}

export default App;
