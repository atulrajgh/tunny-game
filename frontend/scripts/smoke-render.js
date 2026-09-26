// Mounts the real App in jsdom and drives it through every screen an admin or a player
// can reach. The CRA build cannot catch a temporal-dead-zone or undefined reference
// inside a component body - the browser just throws and renders a blank page. That is
// exactly how the "Hand Log" crash shipped (`const log` declared after the adminPanel
// JSX that reads it). This fails on that class of bug instead of in production.
//
//   node scripts/smoke-render.js
//
// Uses @babel/parser, @babel/traverse and jsdom, all already in react-scripts' tree.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const FRONTEND = path.resolve(__dirname, '..');
const APP = path.join(FRONTEND, 'src', 'App.js');
const SRC = fs.readFileSync(APP, 'utf8');
const nm = (m) => require(path.join(FRONTEND, 'node_modules', m));

const problems = [];

// ---------------------------------------------------------------------------
// 1. Static pass - temporal dead zones inside every function body.
//    Uses acorn (babel/parser 7.29 in this tree returns nodes without
//    `declarators`, which would make this pass silently vacuous).
// ---------------------------------------------------------------------------
const acorn = require(path.join(FRONTEND, 'node_modules', 'acorn'));
const jsx = require(path.join(FRONTEND, 'node_modules', 'acorn-jsx'));
const acornParser = acorn.Parser.extend(jsx());

const ast = acornParser.parse(SRC, {
  ecmaVersion: 2022, sourceType: 'module', locations: true,
});

// Minimal walker - the bundled acorn-walk does not know every node type the JSX
// plugin emits, and coupling to its version is not worth it.
const SKIP_KEYS = new Set(['type', 'loc', 'start', 'end', 'range']);
function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  const chain = ancestors.concat([node]);
  if (visit(node, chain) === false) return;
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walk(c, visit, chain);
    else walk(v, visit, chain);
  }
}

// For every function-like node, collect the const/let it declares directly, then
// flag any reference to those names that appears ABOVE the declaration line.
const FUNCTION_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod',
]);
const NESTED = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod',
]);

// Is this identifier a property/key read rather than a variable reference?
function isPropertyName(node, chain) {
  const par = chain[chain.length - 2];
  if (!par) return false;
  if ((par.type === 'MemberExpression' || par.type === 'OptionalMemberExpression') &&
      par.property === node && !par.computed) return true;
  if ((par.type === 'Property' || par.type === 'PropertyDefinition') && par.key === node && !par.computed) return true;
  return false;
}

function collectDecls(fnNode) {
  const found = []; // { name, line, topLevel }
  // One walk, recording every declarator in this function (nested blocks included,
  // nested functions excluded) and whether it sits directly in the function body.
  // Start at fnNode so each chain carries the function, letting us spot depth-0 decls.
  walk(fnNode, (n, chain) => {
    if (n !== fnNode && chain.length > 1 && NESTED.has(n.type)) return false;
    if (n.type !== 'VariableDeclarator' || !n.id || n.id.type !== 'Identifier') return;
    const parent = chain[chain.length - 2];
    const declStmt = chain[chain.length - 3];
    const block = chain[chain.length - 4];
    found.push({
      name: n.id.name,
      line: n.id.loc.start.line,
      // fnNode -> BlockStatement -> VariableDeclaration -> VariableDeclarator
      topLevel: !!parent && parent.type === 'VariableDeclaration' &&
        !!declStmt && declStmt.type === 'BlockStatement' && block === fnNode,
    });
  }, []);
  const top = new Map();
  const counts = new Map();
  for (const d of found) {
    if (d.topLevel && !top.has(d.name)) top.set(d.name, d.line);
    counts.set(d.name, (counts.get(d.name) || 0) + 1);
  }
  // A name declared in more than one scope (an early-return block redeclaring a
  // helper, say) cannot be judged by line number alone - leave it to the mount pass.
  for (const [name, c] of counts) if (c > 1) top.delete(name);
  return top;
}

walk(ast, (node, chain) => {
  if (!FUNCTION_TYPES.has(node.type)) return;
  const decls = collectDecls(node);
  if (!decls.size) return;
  let name = 'anonymous';
  for (let i = chain.length - 2; i >= 0; i--) {
    const a = chain[i];
    if ((a.type === 'FunctionDeclaration' || a.type === 'FunctionExpression') && a.id) { name = a.id.name; break; }
    if (a.type === 'VariableDeclarator' && a.id && a.id.type === 'Identifier') { name = a.id.name; break; }
    if ((a.type === 'ObjectMethod' || a.type === 'ClassMethod') && a.key && a.key.name) { name = a.key.name; break; }
  }
  // Walk this function's own body only. Nested functions are skipped: their bodies run
  // later (effects, callbacks), long after the enclosing body has initialised.
  walk(node, (n, nchain) => {
    if (n !== node && NESTED.has(n.type)) return false;
    if (n.type !== 'Identifier') return;
    if (isPropertyName(n, nchain)) return;
    const line = decls.get(n.name);
    if (line != null && n.loc.start.line < line) {
      problems.push(
        `TDZ: '${n.name}' referenced on line ${n.loc.start.line} but declared on ` +
          `line ${line} in ${name}()`
      );
    }
  }, []);
});

// Module-level names (components, constants) must be declared or imported.
const declaredTop = new Set();
for (const n of ast.body) {
  if (n.type === 'ImportDeclaration') for (const s of n.specifiers) declaredTop.add(s.local.name);
  else if (n.type === 'VariableDeclaration') for (const d of n.declarations) {
    if (d.id && d.id.type === 'Identifier') declaredTop.add(d.id.name);
  } else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) {
    declaredTop.add(n.id.name);
  }
}
const BUILTINS = new Set([
  'window', 'document', 'localStorage', 'navigator', 'console', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'Object', 'Array', 'String', 'Number', 'Boolean', 'JSON',
  'Math', 'Date', 'Error', 'Promise', 'Map', 'Set', 'isNaN', 'parseInt', 'parseFloat',
  'fetch', 'URLSearchParams', 'globalThis',
]);
const usedTop = new Set();
walk(ast, (node, chain) => {
  if (node.type === 'JSXIdentifier') { usedTop.add(node.name); return; }
  if (node.type !== 'Identifier') return;
  if (isPropertyName(node, chain)) return;
  // Only genuine module-scope usage: anything inside a function is that
  // function's own business and is caught by the mount pass if it is wrong.
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i];
    if (a.type === 'FunctionDeclaration' || a.type === 'FunctionExpression' ||
        a.type === 'ArrowFunctionExpression' || a.type === 'ObjectMethod' || a.type === 'ClassMethod') return;
  }
  usedTop.add(node.name);
});
for (const name of usedTop) {
  if (declaredTop.has(name) || BUILTINS.has(name) || /^[a-z]/.test(name)) continue;
  problems.push(`UNDEFINED module-level name referenced: '${name}'`);
}

// ---------------------------------------------------------------------------
// 2. Runtime pass - mount App in jsdom and push real server states through it.
// ---------------------------------------------------------------------------
const { JSDOM } = nm('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;

// Stub socket.io-client so App's useEffect registers handlers we can fire on demand.
// App.js uses a DEFAULT import, so the stub must itself be the callable.
const sock = { handlers: {}, emitted: [], connected: true };
sock.on = (ev, fn) => { (sock.handlers[ev] = sock.handlers[ev] || []).push(fn); return sock; };
sock.once = sock.on;
sock.emit = (ev, payload) => { sock.emitted.push([ev, payload]); };
sock.close = sock.disconnect = () => {};
sock.join = sock.leave = () => {};
sock.id = 'stub-socket';
sock.io = { transport: { name: 'stub' } };
sock.fire = (ev, payload) => { for (const fn of sock.handlers[ev] || []) fn(payload); };
const socketStub = () => sock;
socketStub.io = () => sock;

const babel = nm('@babel/core');
// Compiles App.js and every local module it imports through the same Babel pass,
// so ESM/JSX in sibling files (UIViewer.js) loads too.
const compileCache = new Map();
function compileLocal(file) {
  if (compileCache.has(file)) return compileCache.get(file).exports;
  const src = fs.readFileSync(file, 'utf8');
  const out = babel.transformSync(src, {
    filename: file,
    presets: [require(path.join(FRONTEND, 'node_modules', 'babel-preset-react-app'))],
    babelrc: false,
    configFile: false,
  }).code;
  const mod = new Module(file, null);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod.require = (id) => {
    if (id === 'socket.io-client') return socketStub;
    if (id.endsWith('.css')) return {}; // CRA handles CSS; Node cannot parse it
    if (id.startsWith('.')) {
      let f = path.resolve(path.dirname(file), id);
      if (!fs.existsSync(f)) f += '.js';
      return compileLocal(f);
    }
    return Module.prototype.require.call(mod, id);
  };
  compileCache.set(file, mod);
  mod._compile(out, file);
  return mod.exports;
}
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
globalThis.__tunnySock = sock;
const App = compileLocal(APP).default;

const React = nm('react');
const ReactDOM = nm('react-dom/client');
const { act } = nm('react-dom/test-utils');

const p = (name, position, team) => ({
  id: 'p-' + name, name, position, team, hand: [], cardCount: 6, bid: null, online: true, isBot: false,
});
const meGuest = (o) => Object.assign({ id: 'p-Ann', name: 'Ann', position: 'N', team: 'N-S', isAdmin: false, isSpectator: false, isBot: false }, o);

const base = (over) => Object.assign({
  state: 'waiting',
  players: [p('Ann', 'N', 'N-S'), p('Bob', 'S', 'N-S'), p('Cid', 'E', 'E-W'), p('Dan', 'W', 'E-W')],
  spectators: [],
  positions: { N: 'p-Ann', S: 'p-Bob', E: 'p-Cid', W: 'p-Dan' },
  me: meGuest({}),
  admin: { id: 'p-Ann', name: 'Ann' },
  scores: { 'N-S': 0, 'E-W': 0 }, teamPoints: { 'N-S': 0, 'E-W': 0 }, teamTricks: { 'N-S': 0, 'E-W': 0 },
  currentTrick: [], trickHistory: [], trickNumber: 0, handNumber: 1, highestBid: null, bidHistory: {},
  declarer: { id: 'p-Ann', name: 'Ann', position: 'N' },
  dealer: { id: 'p-Dan', name: 'Dan', position: 'W' },
  trumpSuit: null, trumpRevealed: false, trumpCard: null,
  redealPending: null, redealCount: 0,
  stuckSeat: null, lastHandLog: null, handIntegrity: null,
  winner: null, version: '1.9.2601',
}, over);

const logFor = (over) => Object.assign({
  handNumber: 1, startedAt: 1, dealer: 'W', declarer: 'N', bid: 100,
  trumpSuit: '♥', reservedTrump: 'A♥', trumpRevealed: true,
  seats: {
    N: { position: 'N', name: 'Ann', id: 'p-Ann', team: 'N-S', handSize: 6, bid: 100 },
    S: { position: 'S', name: 'Bob', id: 'p-Bob', team: 'N-S', handSize: 5, bid: 'pass' },
    E: { position: 'E', name: 'Cid', id: 'p-Cid', team: 'E-W', handSize: 6, bid: 'pass' },
    W: { position: 'W', name: 'Dan', id: 'p-Dan', team: 'E-W', handSize: 6, bid: 'pass' },
  },
  plays: [
    { at: 1, trick: 1, position: 'N', card: 'J♠', kind: 'card', handAfter: 5, next: 'E' },
    { at: 2, trick: 1, position: 'E', card: 'A♠', kind: 'card', handAfter: 5, next: 'S' },
    { at: 3, trick: 1, position: 'S', card: 'K♠', kind: 'reserved_trump', handAfter: 4, next: 'W' },
  ],
  events: [],
  integrity: [{ at: 4, reason: 'after-trick', missingCards: 1, repairs: [{ position: 'N', card: '9♣' }], unrecovered: 0 }],
  result: null,
}, over);

const sealed = logFor({
  plays: [], integrity: [],
  result: {
    handNumber: 1, declarer: 'N', bid: 100, declarerTeam: 'N-S', declarerTricks: 3,
    declarerHCP: 210, required: 200, made: true, winnerTeam: 'N-S', points: 2,
    scores: { 'N-S': 2, 'E-W': 0 },
    tricks: [0, 1, 2, 3, 4, 5].map((n) => ({ trick: n, cards: ['N:J♠', 'E:A♠', 'S:K♠', 'W:9♠'], winner: 'N', winnerTeam: 'N-S', points: 20 })),
  },
});

const trick = (n) => ({
  trickNumber: n,
  cards: [
    { position: 'N', card: { rank: 'J', suit: '♠' }, winnerPosition: 'N' },
    { position: 'S', card: { rank: 'K', suit: '♠' } },
    { position: 'E', card: { rank: 'A', suit: '♠' } },
    { position: 'W', card: { rank: '9', suit: '♠' } },
  ],
  winnerPosition: 'N', winner: 'N-S', winnerTeam: 'N-S', winnerPoints: 20,
});

const adminMe = meGuest({ position: null, isAdmin: true });
const cases = [
  ['login screen', null, null],
  ['waiting - admin, no log yet', base({ me: adminMe }), 'room_joined'],
  ['waiting - admin, live hand log', base({ me: adminMe, lastHandLog: logFor(), handIntegrity: { ok: false, shortSeats: [{ position: 'S', counted: 5, expected: 6 }], orphanCards: ['9♣'], duplicateTrickCards: [] } }), 'room_joined'],
  ['waiting - admin, sealed result', base({ me: adminMe, lastHandLog: sealed }), 'room_joined'],
  ['waiting - seated player', base({}), 'room_joined'],
  ['waiting - spectator', base({ me: meGuest({ id: 'p-Zed', name: 'Zed', position: null, isSpectator: true }) }), 'room_joined'],
  ['cut', base({ state: 'cut', cutCard: 'J♠' }), 'room_joined'],
  ['bidding', base({ state: 'bidding', highestBid: 100, bidHistory: { 'p-Ann': 100 }, currentPlayer: { id: 'p-Ann', name: 'Ann', position: 'N' } }), 'room_joined'],
  ['trump_selection', base({ state: 'trump_selection' }), 'room_joined'],
  ['playing - player, live trick', base({ state: 'playing', trumpSuit: '♥', trumpRevealed: true, leadSuit: '♠', currentTrick: [{ position: 'N', card: { rank: 'J', suit: '♠' } }] }), 'room_joined'],
  ['playing - admin, stuck seat', base({ state: 'playing', trumpSuit: '♥', trumpRevealed: true, currentPlayer: { id: 'p-Dan', name: 'Dan', position: 'W' }, stuckSeat: { position: 'W', name: 'Dan' }, me: adminMe }), 'room_joined'],
  ['playing - admin, log + clean audit', base({ state: 'playing', trumpSuit: '♥', trumpRevealed: true, leadSuit: '♠', trickHistory: [trick(0), trick(1)], currentPlayer: { id: 'p-Ann', name: 'Ann', position: 'N' }, lastHandLog: logFor(), handIntegrity: { ok: true, shortSeats: [], orphanCards: [], duplicateTrickCards: [] }, me: adminMe }), 'room_joined'],
  ['playing - redeal pending', base({ state: 'redeal_pending', redealPending: { reason: 'Declarer team holds all 6 trumps' }, redealCount: 2 }), 'room_joined'],
  ['hand review', base({ state: 'hand_review', highestBid: 100, trickHistory: [0, 1, 2, 3, 4, 5].map(trick) }), 'room_joined'],
  ['game over', base({ state: 'game_over', winner: 'N-S', scores: { 'N-S': 12, 'E-W': 4 } }), 'room_joined'],
];

let mounted = 0;
for (const [label, state, prime] of cases) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  try {
    const root = ReactDOM.createRoot(container);
    act(() => { root.render(React.createElement(App, {})); });
    if (prime) {
      const st = state;
      act(() => {
        sock.fire('room_joined', { gameId: 'g1', playerId: st.me.id, isAdmin: !!st.me.isAdmin, isSpectator: !!st.me.isSpectator });
        sock.fire('state', st);
      });
    }
    mounted++;
    const text = container.textContent || '';
    if (/You need to enable JavaScript|Cannot access|is not a function|of undefined/.test(text)) {
      problems.push(`RUNTIME: "${label}" rendered broken text: ${text.slice(0, 140)}`);
    }
    for (const e of errors) {
      if (/Warning: |validateDOMNesting|deprecated/i.test(e)) continue;
      problems.push(`RUNTIME: "${label}" console error: ${e.slice(0, 200)}`);
    }
  } catch (e) {
    problems.push(`RUNTIME: "${label}" threw: ${e && e.message}`);
  } finally {
    console.error = origError;
  }
}


if (problems.length) {
  console.error('FAIL');
  for (const p2 of [...new Set(problems)]) console.error('  - ' + p2);
  process.exit(1);
}
console.log(`OK  no TDZ/undefined names; ${mounted}/${cases.length} screens mounted clean`);
