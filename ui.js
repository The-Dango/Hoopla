(() => {
const $ = id => document.getElementById(id);
const { EMPTY, DOT, STAR, START } = Logic;
const SHAPES = [['square','Square'],['rectangle','Rectangle'],['octagon','Octagon'],['carved','Carved'],['blank','Blank']];
const PICK_SHAPES = [['random','Random'],['square','Square'],['rectangle','Rectangle'],['octagon','Octagon'],['carved','Carved']];
const KS = [[1,'1 hoop'],[2,'2 hoops']];
const SZ = [[0,'Small'],[2,'Big']];
const DIFF = [['easy','Easy'],['medium','Medium'],['hard','Hard']];
const NS = 'http://www.w3.org/2000/svg';
const CS = 40, M = 30;

// The build lives in index.html's <meta name="build">, which is also what
// stamps the script URLs, so there is one thing to bump and the page can never
// run against a cached older copy of this file.
const BUILD = (document.querySelector('meta[name=build]') || {}).content || 'dev';

// Storage moved from the prototype's old key prefix to hoopla-. Carry anything
// already on the device across once, so nobody loses a puzzle in progress.
const NSKEY = 'hoopla-', OLDKEY = 'starproto-';
(function migrateStorage() {
  try {
    if (localStorage.getItem(NSKEY + 'migrated')) return;
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(OLDKEY)) continue;
      const to = NSKEY + k.slice(OLDKEY.length);
      if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
    localStorage.setItem(NSKEY + 'migrated', '1');
  } catch (e) {}
})();
const SAVE = NSKEY + 'inprogress';

let settings = { rung: 'gentle', pickShape: 'random', shape: 'square', k: 1, size: 0, difficulty: 'easy', holes: false,
  auto: false, fillRegion: false, fillLine: false, err: true, quiet: false };
try { const s = JSON.parse(localStorage.getItem(NSKEY + 'settings') || 'null');
  // The one "blank out finished units" switch became one per rule; carry it across.
  let moved = false;
  if (s && 'fill' in s && !('fillRegion' in s)) { s.fillRegion = s.fill; s.fillLine = s.fill; delete s.fill; moved = true; }
  if (s) Object.assign(settings, s);
  if (moved) saveSettings(); } catch (e) {}
if (!SHAPES.some(([v]) => v === settings.shape)) settings.shape = 'square';
if (settings.size === 1) settings.size = 0;
if (settings.k > 2) settings.k = 2;
function saveSettings() { try { localStorage.setItem(NSKEY + 'settings', JSON.stringify(settings)); } catch (e) {} }

let P = null, marks = null, autoSet = new Set(), givenSet = new Set(), history = [];
let solved = false, revealed = false, gaveUp = false, lastOpts = null;
let t0 = 0, elapsed = 0, timerId = null, colors = [], hints = 0, curHint = null;
let placements = 0, placedAt = new Map(), shows = 0; const GRACE_MS = 3000;

// ---------- screens ----------
let pickerView = 'menu', beforeSettings = 'menu';
function showPicker(view = 'menu') {
  $('dialog').classList.remove('show', 'blur'); $('game').classList.remove('dialog-up');
  if (view === 'settings' && pickerView !== 'settings') beforeSettings = pickerView;
  pickerView = view;
  $('game').hidden = true; $('picker').hidden = false;
  for (const [id, key] of [['viewMenu','menu'],['viewPick','pick'],['viewOwn','own'],['viewSettings','settings']]) $(id).hidden = key !== view;
  if (view === 'menu') renderMenu();
  prefetch();
}
function showGame() { stopCountdown(); $('picker').hidden = true; $('game').hidden = false; }
$('menuPick').onclick = () => showPicker('pick');
$('menuOwn').onclick = () => showPicker('own');
// the gear opens settings and closes them again, landing back where you were
$('gearBtn').onclick = () => showPicker(pickerView === 'settings' ? beforeSettings : 'settings');
$('setBack').onclick = () => showPicker(beforeSettings);
$('pickBack').onclick = $('ownBack').onclick = () => showPicker('menu');

function dailyDone() { try { return JSON.parse(localStorage.getItem(NSKEY + 'daily-' + Logic.dailyOptions().day) || 'null'); } catch (e) { return null; } }

// Coarsest unit that still reads as a number: hours past the last hour, then
// minutes past the last minute, then seconds.
function until(ms) {
  const s = Math.ceil(ms / 1000);
  const n = s > 3600 ? Math.floor(s / 3600) : s > 60 ? Math.floor(s / 60) : s;
  const unit = s > 3600 ? 'hour' : s > 60 ? 'minute' : 'second';
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
// Ticks only while the menu is up and today's board is spent; stops itself the
// moment the clock rolls over, and re-renders so the new board unlocks in place.
let dailyTimer = null;
function stopCountdown() { if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; } }
function startCountdown() {
  stopCountdown();
  dailyTimer = setInterval(() => {
    if ($('picker').hidden || pickerView !== 'menu') return stopCountdown();
    if (Logic.msUntilDailyReset() <= 0) { stopCountdown(); return renderMenu(); }
    renderDailySub();
  }, 1000);
}
function renderDailySub() {
  const o = Logic.dailyOptions(), names = Object.fromEntries(SHAPES), done = dailyDone();
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const next = `next puzzle in ${until(Logic.msUntilDailyReset())}`;
  $('dailySub').textContent = !done
    ? `${days[o.weekday]} · ${names[o.shape]}, ${o.k} hoop${o.k > 1 ? 's' : ''} per region, ${o.difficulty}`
    : done.gaveUp ? `Given up — ${next}` : `Finished in ${fmt(done.final)} — ${next}`;
  $('menuDaily').disabled = !!done;
  return done;
}
function renderMenu() {
  const done = renderDailySub();
  if (done) startCountdown(); else stopCountdown();
  const saved = savedGame();
  $('resumeBtn').hidden = !saved;
  if (saved) $('resumeInfo').textContent = `${saved.P.daily ? 'Daily' : cap(saved.P.difficulty)} board, paused at ${fmt(saved.elapsed)}`;
  $('menuNote').textContent = 'Everyone gets the same daily board. It changes at midnight New York time.';
}
function renderWinPick() { // change your mind about the next board without leaving the card
  segChoice($('winRungSeg'), Logic.RUNGS.map(r => [r.key, r.label]), settings.rung,
    v => { settings.rung = v; saveSettings(); renderPickers(); renderWinPick(); prefetch(); });
  segChoice($('winShapeSeg'), PICK_SHAPES, settings.pickShape,
    v => { settings.pickShape = v; saveSettings(); renderPickers(); renderWinPick(); prefetch(); });
  const sel = lastOpts && lastOpts.sel;
  const same = sel && sel.rung === settings.rung && sel.pickShape === settings.pickShape;
  $('winNew').textContent = same ? 'Another one' : 'Start';
}
function renderPickers() {
  segChoice($('rungSeg'), Logic.RUNGS.map(r => [r.key, r.label]), settings.rung, v => { settings.rung = v; saveSettings(); renderPickers(); prefetch(); });
  segChoice($('pickShapeSeg'), PICK_SHAPES, settings.pickShape, v => { settings.pickShape = v; saveSettings(); renderPickers(); prefetch(); });
  segChoice($('shapeSeg'), SHAPES, settings.shape, v => { settings.shape = v; saveSettings(); renderPickers(); });
  segChoice($('kSeg'), KS, settings.k, v => { settings.k = v; saveSettings(); renderPickers(); });
  segChoice($('sizeSeg'), SZ, settings.size, v => { settings.size = v; saveSettings(); renderPickers(); });
  segChoice($('diffSeg'), DIFF, settings.difficulty, v => { settings.difficulty = v; saveSettings(); renderPickers(); });
  $('optAuto').checked = settings.auto;
  $('optFillRegion').checked = settings.fillRegion; $('optFillLine').checked = settings.fillLine; $('optErr').checked = settings.err; $('optQuiet').checked = settings.quiet;
  $('kField').style.display = settings.shape === 'blank' ? 'none' : '';
  const same = lastOpts && lastOpts.source === 'own' && optsKey(lastOpts.opts) === optsKey(ownOpts());
  $('ownStart').textContent = same ? 'Another one' : 'Start';
}
function segChoice(el, items, value, onPick) {
  el.innerHTML = '';
  for (const [v, label] of items) { const b = document.createElement('button'); b.textContent = label;
    b.setAttribute('aria-pressed', String(value === v)); b.onclick = () => onPick(v); el.appendChild(b); }
}

$('optAuto').onchange = e => { settings.auto = e.target.checked; saveSettings(); if (P) draw(); };
$('optFillRegion').onchange = e => { settings.fillRegion = e.target.checked; saveSettings(); if (P) draw(); };
$('optFillLine').onchange = e => { settings.fillLine = e.target.checked; saveSettings(); if (P) draw(); };
$('optErr').onchange = e => { settings.err = e.target.checked; saveSettings(); if (P) draw(); };
$('optQuiet').onchange = e => { settings.quiet = e.target.checked; saveSettings(); };

// ---------- building ----------
let nextUp = null, nextKey = null, building = false;
function ownOpts() { return { shape: settings.shape, k: settings.shape === 'blank' ? 1 : settings.k, size: settings.size,
  difficulty: settings.difficulty }; }
function pickOpts() { return Logic.rungOptions(settings.rung, settings.pickShape); }
function optsKey(o) { return JSON.stringify(o); }
function prefetch() { // build the likely next board quietly, in slices, while the player is busy
  if (building) return;
  const view = $('viewOwn').hidden === false ? 'own' : 'pick';
  const o = view === 'own' ? ownOpts() : { rung: settings.rung, pickShape: settings.pickShape };
  const key = optsKey(o);
  if (nextUp && nextKey === key) return;
  building = true;
  const opts = view === 'own' ? o : pickOpts();
  Logic.buildAsync(Engine, opts, p => { building = false; if (p) { nextUp = p; nextKey = key; } }, 8000);
}
function startPuzzle(opts, key, source) {
  lastOpts = { opts, key, source: source || (lastOpts && lastOpts.source) || 'own',
    sel: { rung: settings.rung, pickShape: settings.pickShape } };
  showGame(); clearSaved();
  $('busy').textContent = 'Building a puzzle…'; $('busy').classList.add('show');
  $('win').classList.remove('show'); $('board').style.opacity = .25; closeBar();
  if (nextUp && key && nextKey === key) { const p = nextUp; nextUp = null; nextKey = null; return begin(p, opts); }
  setTimeout(() => begin(Logic.build(Engine, opts), opts), 30);
}
function begin(p, opts) {
  $('busy').classList.remove('show'); $('board').style.opacity = 1;
  if (!p) { $('busy').textContent = 'That combination did not build in time. Go back and try again.'; $('busy').classList.add('show'); return; }
  if (opts && opts.daily) p.daily = opts.daily;
  P = p; marks = Logic.startMarks(P); givenSet = new Set(P.givens); history = [];
  solved = false; revealed = false; gaveUp = false; hints = 0; placements = 0; placedAt = new Map(); shows = 0;
  colorRegions(); startTimer(0); buildBoard(); draw(); renderRules(); renderDev(); renderCounts(); renderNote(); renderPickers();
  setTimeout(prefetch, 600);
}
$('menuDaily').onclick = () => { const o = Logic.dailyOptions(); startPuzzle({ ...o, daily: o.day }, null, 'daily'); };
$('pickStart').onclick = () => startPuzzle(pickOpts(), optsKey({ rung: settings.rung, pickShape: settings.pickShape }), 'pick');
$('ownStart').onclick = () => startPuzzle(ownOpts(), optsKey(ownOpts()), 'own');
$('winNew').onclick = () => {
  if (lastOpts && lastOpts.source === 'daily') return showPicker('menu');
  if (lastOpts && lastOpts.source === 'pick') return startPuzzle(pickOpts(), optsKey({ rung: settings.rung, pickShape: settings.pickShape }), 'pick');
  return startPuzzle(ownOpts(), optsKey(ownOpts()), 'own');
};
$('winMenu').onclick = () => showPicker('menu');
$('codeGo').onclick = () => { const o = Logic.parseCode($('codeIn').value);
  if (!o) { $('codeIn').value = ''; $('codeIn').placeholder = 'Not a puzzle code'; return; }
  startPuzzle(o, null, 'own'); };
$('codeIn').onkeydown = e => { if (e.key === 'Enter') $('codeGo').click(); };

// ---------- pausing and resuming ----------
function savedGame() { try { const s = JSON.parse(localStorage.getItem(SAVE) || 'null');
  return s && s.P ? s : null; } catch (e) { return null; } }
function clearSaved() { try { localStorage.removeItem(SAVE); } catch (e) {} }
function pauseAndLeave() {
  if (!P || solved) return showPicker('menu');
  clearInterval(timerId);
  try { localStorage.setItem(SAVE, JSON.stringify({ P: Logic.toJSON(P), marks: Array.from(marks), elapsed,
    hints, placements, shows, opts: lastOpts && lastOpts.opts, key: lastOpts && lastOpts.key })); } catch (e) {}
  closeBar(); showPicker('menu');
}
$('resumeBtn').onclick = () => { const s = savedGame(); if (!s) return;
  showGame(); clearSaved();
  P = Logic.fromJSON(s.P); marks = Uint8Array.from(s.marks); givenSet = new Set(P.givens); history = [];
  solved = false; revealed = false; gaveUp = false; hints = s.hints || 0; placements = s.placements || 0; shows = s.shows || 0;
  placedAt = new Map(); lastOpts = s.opts ? { opts: s.opts, key: s.key } : null;
  colorRegions(); startTimer(s.elapsed || 0); buildBoard(); draw(); renderRules(); renderDev(); renderCounts(); renderNote();
};
window.addEventListener('pagehide', () => { if (P && !solved && !$('game').hidden) pauseAndLeave(); });

// ---------- give up ----------
$('quit').onclick = () => {
  if (!P || solved) return showPicker('menu');
  closeBar();
  showModal('Leave this puzzle?',
    'Leaving keeps the board so you can come back to it. Giving up ends the round.', [
    ['Leave for now', true, pauseAndLeave],
    ['Give up and see it', false, () => {
      gaveUp = true; revealed = true; solved = true; clearInterval(timerId);
      marks = Logic.startMarks(P); for (const c of P.solution) marks[c] = STAR; closeBar(); draw();
      if (P.daily) { try { localStorage.setItem(NSKEY + 'daily-' + P.daily, JSON.stringify({ gaveUp: true })); } catch (e) {} }
      $('winTitle').textContent = 'Here it is';
      $('winScore').innerHTML = `<dd class="note">No score for a puzzle you gave up on. Take a look at how it fits together.</dd>`;
      $('win').classList.add('show');
    }],
    ['Keep playing', false, () => {}]]);
};

// ---------- timer, counts, text ----------
function startTimer(from) { clearInterval(timerId); elapsed = from || 0; t0 = Date.now() - elapsed * 1000; tick(); timerId = setInterval(tick, 1000); }
function pauseClock() { clearInterval(timerId); timerId = null; }
function resumeClock() { if (timerId || !P || solved) return; t0 = Date.now() - elapsed * 1000; timerId = setInterval(tick, 1000); }
function tick() { if (solved) return; elapsed = Math.floor((Date.now() - t0) / 1000); $('timer').textContent = fmt(elapsed); }
function fmt(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
const cap = w => w[0].toUpperCase() + w.slice(1);
function need() { return P.solution.length - P.givens.length; }
function renderCounts() {
  const n = need(), extra = Math.max(0, placements - n), parts = [`Placed: ${placements} of ${n}`];
  if (extra) parts.push(`${extra} extra`);
  if (hints) parts.push(`${hints} ${hints === 1 ? 'hint' : 'hints'}`);
  if (shows) parts.push(`${shows} ${shows === 1 ? 'reveal' : 'reveals'}`);
  const pen = Logic.result(P, 0, hints, extra, shows).penalty; if (pen) parts.push(`+${pen}s penalties`);
  $('hintCount').textContent = parts.join(', ');
}
function renderNote() {
  const g = P.givens.length, parts = [];
  if (P.daily) parts.push(`Daily puzzle for ${P.daily}.`);
  else if (P.difficulty !== P.asked && P.asked) parts.push(`This board didn't come out ${P.asked}, so it's ${P.difficulty}.`);
  else parts.push(`${cap(P.difficulty)} puzzle.`);
  if (g) parts.push(`${g === 1 ? '1 hoop is' : g + ' hoops are'} placed for you to start.`);
  $('note').textContent = parts.join(' ');
  $('gameTitle').textContent = P.daily ? 'Daily puzzle' : `${cap(P.difficulty)} · ${P.W}×${P.H}`;
  const chip = $('gameCode');
  chip.textContent = P.code || '—';
  chip.hidden = !P.code;
}
function renderRules() {
  const k = P.k, s = k === 1 ? 'hoop' : 'hoops', c = Logic.costs(P);
  $('rules').textContent = !P.regions
    ? `Drop ${P.solution.length} hoops so each row and column holds the number shown at its edges. Hoops never touch, not even diagonally. There are no regions to help you here.`
    : P.uniform
      ? `Drop hoops so every colored region, every row and every column holds exactly ${k} ${s}. Hoops never touch, not even diagonally.`
      : `Drop hoops so every colored region holds exactly ${k} ${s}, and each row and column holds the number shown at its edges. Hoops never touch, not even diagonally.`;
  const kc = $('gameK');
  kc.hidden = !P.regions; // a blank board has no colours to count against
  if (P.regions) {
    kc.setAttribute('aria-label', `${k} ${s} per colour`);
    kc.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">`
      + `<circle cx="12" cy="12" r="7.6" fill="none" stroke="var(--gold)" stroke-width="5"/>`
      + `<circle cx="12" cy="12" r="10.1" fill="none" stroke="var(--line)" stroke-width="1.6"/>`
      + `<circle cx="12" cy="12" r="5.1" fill="none" stroke="var(--line)" stroke-width="1.6"/></svg>`
      + `<span>\u00d7 ${k}</span>`;
  }
  $('scoring').textContent = `Target time ${fmt(Logic.par(P))}. Each extra hoop adds ${c.extraStar}s, each reveal ${c.reveal}s, each hint ${c.hint}s.`;
}
function renderDev() {
  const s = P.stats || {}, cells = P.mask.filter(Boolean).length;
  $('devStats').innerHTML = `<dt>Board</dt><dd>${P.W} × ${P.H}, ${cells} cells</dd><dt>Regions</dt><dd>${P.R}</dd>`
    + `<dt>Built in</dt><dd>${s.ms || 0} ms, ${s.attempts || 1} tries</dd>`
    + `<dt>Puzzle code</dt><dd>${P.code || '—'}</dd>`
    + `<dt>Difficulty</dt><dd>${P.difficulty} (hardest step: level ${P.grade.maxLevel} of 6)</dd>`
    + `<dt>Target from</dt><dd>${P.grade.steps} solving steps: ${Object.entries(P.grade.byLevel).map(([l, n]) => `${n}×L${l}`).join(', ')}</dd>`
    + `<dt>Target time</dt><dd>${fmt(Logic.par(P))}</dd><dt>Starting stars</dt><dd>${P.givens.length}</dd>`;
}

// ---------- board drawing ----------
function colorRegions() {
  const { W, H, region, R } = P, adj = Array.from({ length: R }, () => new Set());
  for (let c = 0; c < W * H; c++) { if (region[c] < 0) continue; const x = c % W;
    if (x < W - 1 && region[c + 1] >= 0 && region[c + 1] !== region[c]) { adj[region[c]].add(region[c + 1]); adj[region[c + 1]].add(region[c]); }
    if (c + W < W * H && region[c + W] >= 0 && region[c + W] !== region[c]) { adj[region[c]].add(region[c + W]); adj[region[c + W]].add(region[c]); } }
  const order = [...Array(R).keys()].sort((a, b) => adj[b].size - adj[a].size), off = Math.floor(Math.random() * 10);
  colors = new Array(R).fill(-1);
  for (const g of order) { const used = new Set([...adj[g]].map(o => colors[o]));
    for (let i = 0; i < 10; i++) { const c = (i + off + g * 3) % 10; if (!used.has(c)) { colors[g] = c; break; } }
    if (colors[g] < 0) colors[g] = g % 10; }
}
let gCells, gShade, gGrid, gMarks, gDim, gHint, gClues;
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function buildBoard() {
  const { W, H, mask, region } = P, svg = $('board');
  svg.innerHTML = ''; svg.setAttribute('viewBox', `0 0 ${M + W * CS + M} ${M + H * CS + M}`);
  svg.style.maxWidth = Math.min(640, (M * 2 + W * CS) * 1.7) + 'px';
  gCells = el('g', {}, svg); gShade = el('g', {}, svg); gGrid = el('g', {}, svg); gMarks = el('g', {}, svg); gDim = el('g', {}, svg); gHint = el('g', {}, svg); gClues = el('g', {}, svg);
  let thin = '', thick = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = y * W + x; if (!mask[c]) continue;
    const X = M + x * CS, Y = M + y * CS;
    el('rect', { x: X, y: Y, width: CS, height: CS, fill: P.regions ? `var(--r${colors[region[c]]})` : 'var(--panel)', class: 'cell' }, gCells);
    const g = region[c], rOf = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H || !mask[yy * W + xx]) ? -2 : region[yy * W + xx];
    const edges = [[rOf(x + 1, y), `M${X + CS} ${Y}v${CS}`], [rOf(x, y + 1), `M${X} ${Y + CS}h${CS}`], [rOf(x - 1, y), `M${X} ${Y}v${CS}`], [rOf(x, y - 1), `M${X} ${Y}h${CS}`]];
    edges.forEach(([o, d], i) => { if (o === g) { if (i < 2) thin += d; } else if (i < 2 || o === -2) thick += d; });
  }
  el('path', { d: thin, stroke: 'var(--thin)', 'stroke-width': 1, fill: 'none' }, gGrid);
  el('path', { d: thick, stroke: 'var(--line)', 'stroke-width': 3.2, fill: 'none', 'stroke-linecap': 'square' }, gGrid);
}
function drawHoop(parent, X, Y, state) { // state: 'normal' | 'wrong' | 'win'
  const outer = el('g', { transform: `translate(${X} ${Y + 1})` }, parent), g = el('g', {}, outer);
  const fill = state === 'wrong' ? 'var(--bad)' : state === 'win' ? 'var(--gold)' : 'var(--o)';
  el('circle', { cx: 1.2, cy: 2.2, r: 14, fill: 'none', stroke: 'var(--line)', 'stroke-width': 8, opacity: .16 }, g);
  el('circle', { cx: 0, cy: 0, r: 14, fill: 'none', stroke: fill, 'stroke-width': 8 }, g);
  el('circle', { cx: 0, cy: 0, r: 17.6, fill: 'none', stroke: 'var(--line)', 'stroke-width': 2.4 }, g);
  el('circle', { cx: 0, cy: 0, r: 10.2, fill: 'none', stroke: 'var(--line)', 'stroke-width': 2.4 }, g);
  el('path', { d: 'M-11.4 -8a14.6 14.6 0 0 1 6.6 -5.2', stroke: '#fff', 'stroke-width': 2.6, 'stroke-linecap': 'round', fill: 'none', opacity: .8 }, g);
  return g;
}
function drawX(parent, X, Y, opacity) {
  el('path', { d: `M${X - 8} ${Y - 8}l16 16M${X + 8} ${Y - 8}l-16 16`, stroke: 'var(--dot)', 'stroke-width': 3.4,
    'stroke-linecap': 'round', opacity }, parent);
}
function analyse() {
  const { W, H, region, rowT, colT, k, R } = P;
  const rc = new Array(H).fill(0), cc = new Array(W).fill(0), gc = new Array(R).fill(0), bad = new Set();
  for (let c = 0; c < W * H; c++) if (marks[c] === STAR) { rc[(c / W) | 0]++; cc[c % W]++; gc[region[c]]++; }
  for (let c = 0; c < W * H; c++) if (marks[c] === STAR) { const x = c % W, y = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && marks[ny * W + nx] === STAR) bad.add(c); }
    if (rc[y] > rowT[y] || cc[x] > colT[x] || gc[region[c]] > k) bad.add(c); }
  let done = bad.size === 0; for (let y = 0; y < H; y++) if (rc[y] !== rowT[y]) done = false;
  for (let x = 0; x < W; x++) if (cc[x] !== colT[x]) done = false; for (let g = 0; g < R; g++) if (gc[g] !== k) done = false;
  return { rc, cc, bad, done };
}
function draw(winAnim) {
  const { W, H, rowT, colT } = P, a = analyse();
  autoSet = Logic.autoBlanks(P, marks, { around: settings.auto, region: settings.fillRegion, line: settings.fillLine });
  gMarks.innerHTML = ''; gClues.innerHTML = ''; gShade.innerHTML = '';
  // a row or column with nothing left to decide fades back a little
  const settled = (cells) => { let any = false;
    for (const c of cells) { if (!P.mask[c]) continue; any = true; if (marks[c] === EMPTY && !autoSet.has(c)) return false; }
    return any; };
  const rowDone = [], colDone = [];
  for (let y = 0; y < H; y++) rowDone[y] = settled(Array.from({ length: W }, (_, x) => y * W + x));
  for (let x = 0; x < W; x++) colDone[x] = settled(Array.from({ length: H }, (_, y) => y * W + x));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = y * W + x;
    if (P.mask[c] && (rowDone[y] || colDone[x]))
      el('rect', { x: M + x * CS, y: M + y * CS, width: CS, height: CS, fill: 'var(--line)', opacity: .09 }, gShade); }
  for (let c = 0; c < W * H; c++) { if (!P.mask[c]) continue; const X = M + (c % W) * CS + CS / 2, Y = M + ((c / W) | 0) * CS + CS / 2;
    if (marks[c] === START) drawX(gMarks, X, Y, .3);
    else if (marks[c] === DOT) drawX(gMarks, X, Y, .9);
    else if (marks[c] === EMPTY && autoSet.has(c)) drawX(gMarks, X, Y, .45);
    else if (marks[c] === STAR) {
      const badS = settings.err && a.bad.has(c), winState = solved && !revealed;
      if (givenSet.has(c) && !winState) el('circle', { cx: X, cy: Y, r: 20, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5, opacity: .3 }, gMarks);
      const g = drawHoop(gMarks, X, Y, badS ? 'wrong' : winState ? 'win' : 'normal');
      if (winAnim) { g.classList.add('star-win'); g.style.animationDelay = (((c % W) + ((c / W) | 0)) * 45) + 'ms'; } } }
  const clue = (x, y, t, n) => { const over = n > t, full = n === t;
    el('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 17, 'font-weight': 700,
      fill: settings.err && over ? 'var(--bad)' : 'var(--muted)', opacity: full && !over ? .35 : 1 }, gClues).textContent = t; };
  for (let y = 0; y < H; y++) if (P.mask.slice(y * W, y * W + W).some(Boolean)) {
    clue(M / 2, M + y * CS + CS / 2, rowT[y], a.rc[y]); clue(M + W * CS + M / 2, M + y * CS + CS / 2, rowT[y], a.rc[y]); }
  for (let x = 0; x < W; x++) if (P.mask.some((m, i) => m && i % W === x)) {
    clue(M + x * CS + CS / 2, M / 2, colT[x], a.cc[x]); clue(M + x * CS + CS / 2, M + H * CS + M / 2, colT[x], a.cc[x]); }
  drawHint();
  if (a.done && !solved) win();
}
function win() {
  solved = true; tick(); clearInterval(timerId); closeBar(); draw(true); clearSaved();
  const extra = Math.max(0, placements - need()), r = Logic.result(P, elapsed, hints, extra, shows), c = r.costs;
  const key = `${NSKEY}best-${P.code ? P.code.split('-')[0] : 'x'}`;
  let best = 0, isBest = false;
  try { best = Number(localStorage.getItem(key) || 0); if (!best || r.final < best) { localStorage.setItem(key, r.final); isBest = true; } } catch (e) {}
  const clean = !hints && !extra && !shows;
  $('winTitle').textContent = clean ? 'Clean solve!' : isBest ? 'Solved, new best!' : 'Solved';
  const row = (label, n, each, cost) => n ? `<dt>${label} ${n} × ${each}s</dt><dd>+${fmt(cost)}</dd>` : '';
  const under = r.vsPar === 0 ? 'exactly on target' : r.vsPar < 0 ? `${fmt(-r.vsPar)} under the target` : `${fmt(r.vsPar)} over the target`;
  $('winScore').innerHTML = `<dt>Time</dt><dd>${fmt(elapsed)}</dd>`
    + row('Hints', hints, c.hint, r.hintCost) + row('Extra hoops', extra, c.extraStar, r.extraCost) + row('Reveals', shows, c.reveal, r.revealCost)
    + `<dt class="total">Final</dt><dd class="total">${fmt(r.final)}</dd>`
    + `<dt>Target</dt><dd>${fmt(r.par)}</dd><dd class="note">${under}</dd>`
    + `<dd class="note">Puzzle code ${P.code || '—'} · build ${BUILD}</dd>`;
  const fromPick = lastOpts && lastOpts.source === 'pick';
  $('winPick').hidden = !fromPick;
  if (fromPick) renderWinPick();
  if (P.daily) $('winNew').textContent = 'Back to menu'; else if (!fromPick) $('winNew').textContent = 'Another one';
  if (P.daily) { try { localStorage.setItem(NSKEY + 'daily-' + P.daily, JSON.stringify({ final: r.final, time: elapsed })); } catch (e) {} }
  renderDev();
  setTimeout(() => $('win').classList.add('show'), 700);
}

// ---------- hints, checks ----------
function drawHint() {
  gDim.innerHTML = ''; gHint.innerHTML = ''; if (!curHint) return;
  const targets = new Set(curHint.targets && curHint.targets.length ? curHint.targets : curHint.cells);
  const keep = new Set([...(curHint.cells || []), ...targets]);
  const rect = c => { const X = M + (c % P.W) * CS, Y = M + ((c / P.W) | 0) * CS; return `M${X} ${Y}h${CS}v${CS}h${-CS}Z`; };
  const vb = $('board').viewBox.baseVal;
  let scrim = `M0 0h${vb.width}v${vb.height}h${-vb.width}Z`;
  for (const c of keep) scrim += rect(c);
  el('path', { d: scrim, 'fill-rule': 'evenodd', fill: 'var(--bg)', opacity: .72 }, gDim);
  const accent = curHint.kind === 'mistake' ? 'var(--bad)' : 'var(--gold)';
  const context = [...keep].filter(c => !targets.has(c));
  if (context.length) { let edge = '';
    for (const c of keep) { const x = c % P.W, y = (c / P.W) | 0, X = M + x * CS, Y = M + y * CS;
      if (!keep.has(c - 1) || x === 0) edge += `M${X} ${Y}v${CS}`;
      if (!keep.has(c + 1) || x === P.W - 1) edge += `M${X + CS} ${Y}v${CS}`;
      if (!keep.has(c - P.W) || y === 0) edge += `M${X} ${Y}h${CS}`;
      if (!keep.has(c + P.W) || y === P.H - 1) edge += `M${X} ${Y + CS}h${CS}`; }
    el('path', { d: edge, stroke: accent, 'stroke-width': 2.5, fill: 'none', opacity: .7, 'stroke-dasharray': '6 4' }, gHint); }
  for (const c of targets) { const X = M + (c % P.W) * CS, Y = M + ((c / P.W) | 0) * CS;
    el('rect', { x: X + 1.5, y: Y + 1.5, width: CS - 3, height: CS - 3, rx: 5, fill: accent, opacity: .2 }, gHint);
    el('rect', { x: X + 1.5, y: Y + 1.5, width: CS - 3, height: CS - 3, rx: 5, fill: 'none', stroke: accent, 'stroke-width': 4, class: 'hint-hl' }, gHint); }
}
function showBar(text, tone, buttons, note) {
  const bar = $('hintBar'); bar.className = 'bar' + (tone ? ' ' + tone : ''); bar.hidden = false;
  $('hintText').textContent = text; $('barNote').textContent = note || '';
  const box = $('barBtns'); box.innerHTML = '';
  for (const [label, primary, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; b.onclick = fn; box.appendChild(b); }
}
function closeBar() { curHint = null; $('hintBar').hidden = true; if (gDim) gDim.innerHTML = ''; if (gHint) gHint.innerHTML = ''; }
function showHint() {
  if (!P || solved) return;
  const h = Logic.hint(P, marks, autoSet); if (!h) return;
  curHint = h; hints++; renderCounts(); drawHint();
  const what = h.kind === 'star' ? 'A hoop goes in' : h.kind === 'mistake' ? 'The problem is' : 'You can blank out';
  showBar(h.text, '', [['Do it for me', true, applyHint], ['Got it', false, closeBar]],
    `${what} the ringed cell${(h.targets || h.cells).length > 1 ? 's' : ''}. The dashed outline shows where the reasoning comes from.`);
}
function applyHint() { if (!curHint) return; snapshot(); const h = curHint; change(() => { for (const [c, v] of h.apply) marks[c] = v; }); closeBar(); draw(); }
function showCheck() {
  if (!P || solved) return; closeBar();
  for (const c of placedAt.keys()) placedAt.set(c, -Infinity); // checking ends the misclick window
  const wrong = Logic.wrongCells(P, marks);
  if (!wrong.length) return showBar('Everything on the board so far is correct.', 'good', [['Keep going', true, closeBar]]);
  const cost = Logic.costs(P).reveal;
  showBar('Not quite. Something on the board is wrong.', 'bad', [
    [`Show me (+${cost}s)`, true, () => { shows++; renderCounts();
      curHint = { kind: 'mistake', cells: wrong, targets: wrong }; drawHint();
      showBar(wrong.length === 1 ? 'This cell is marked wrong.' : `These ${wrong.length} cells are marked wrong.`, 'bad',
        [['Do it for me', true, () => { snapshot(); change(() => { for (const c of wrong) marks[c] = EMPTY; }); closeBar(); draw(); }], ['Got it', false, closeBar]],
        wrong.length === 1 ? 'The ringed cell is the one to change.' : 'The ringed cells are the ones to change.'); }],
    ["I'll find it", false, closeBar]]);
}
$('hint').onclick = showHint; $('check').onclick = showCheck;

// ---------- input ----------
function cellAt(ev) { const svg = $('board'), r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  const x = Math.floor(((ev.clientX - r.left) / r.width * vb.width - M) / CS), y = Math.floor(((ev.clientY - r.top) / r.height * vb.height - M) / CS);
  if (x < 0 || y < 0 || x >= P.W || y >= P.H) return -1; const c = y * P.W + x; return P.mask[c] ? c : -1; }
function snapshot() { history.push(marks.slice()); if (history.length > 300) history.shift(); }
function change(fn) { // every board change runs through here, so star placements are counted
  const before = marks.slice(); fn(); const now = Date.now();
  for (let c = 0; c < marks.length; c++) {
    if (marks[c] === STAR && before[c] !== STAR) { placements++; placedAt.set(c, now); }
    else if (before[c] === STAR && marks[c] !== STAR) { const t = placedAt.get(c);
      if (t !== undefined && now - t < GRACE_MS) placements--; placedAt.delete(c); } }
  renderCounts();
}
function nextState(c) { if (marks[c] === STAR) return EMPTY;
  if (marks[c] === DOT || marks[c] === START || autoSet.has(c)) return STAR; return DOT; }
let drag = null;
const board = $('board');
// execCommand is deprecated, but it is synchronous and does not need the
// clipboard permission, so it covers the cases where the async API refuses.
function copyText(text) {
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', '');
  t.style.position = 'fixed'; t.style.top = '0'; t.style.opacity = '0';
  document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(t);
  return ok;
}
// ---------- dialogs that stop play ----------
// Anything the player has to answer goes here rather than in the bar at the
// foot of the screen: the clock stops and the board blurs out behind it, so a
// paused puzzle cannot be worked on while the question is up.
function showModal(title, note, buttons) {
  $('dialogTitle').textContent = title;
  $('dialogNote').textContent = note || '';
  const box = $('dialogBtns'); box.innerHTML = '';
  for (const [label, primary, fn, cls] of buttons) {
    const b = document.createElement('button');
    b.textContent = label; if (primary) b.className = 'primary';
    if (cls) b.className = ((b.className || '') + ' ' + cls).trim();
    b.onclick = () => { closeModal(); fn(); };
    box.appendChild(b);
  }
  pauseClock();
  modalAt = Date.now();
  $('game').classList.add('dialog-up');
  $('dialog').classList.add('show', 'blur');
}
// Restarts the clock on the way out. Anything that ends the round (giving up,
// leaving) stops it again itself, so it does not matter that this runs first.
// The 3s grace on removing a hoop runs on the wall clock, so a dialog would
// eat it while the game clock is stopped. Push the placements forward by however
// long the question was up, and reading it costs nothing.
let modalAt = 0;
function closeModal() {
  const held = modalAt ? Date.now() - modalAt : 0; modalAt = 0;
  if (held) for (const [c, t] of placedAt) placedAt.set(c, t + held);
  $('game').classList.remove('dialog-up');
  $('dialog').classList.remove('show', 'blur');
  resumeClock();
}
function modalOpen() { return $('dialog').classList.contains('show'); }

// ---------- learning the rules ----------
// The two helpers that blank squares out start switched off, so the rules get
// met by playing rather than by reading the settings. When a hoop lands on a
// square a helper would have blanked, name the rule it broke and offer the
// helper. Asked on the 1st, 6th, 11th time and so on: often enough to teach,
// rarely enough that someone who prefers marking by hand is not nagged.
const TRIPS = NSKEY + 'ruletrips';
function trips() { try { return JSON.parse(localStorage.getItem(TRIPS) || '{}'); } catch (e) { return {}; } }
function saveTrips(t) { try { localStorage.setItem(TRIPS, JSON.stringify(t)); } catch (e) {} }

// The unit of a given kind that already holds all the hoops it needs.
function fullUnit(c, before, want) {
  for (const u of P.units) {
    const isRegion = u.kind === 'region';
    if (want === 'region' ? !isRegion : isRegion) continue;
    if (u.target <= 0 || !u.cells.includes(c)) continue;
    let n = 0; for (const x of u.cells) if (before[x] === STAR) n++;
    if (n >= u.target) return u;
  }
  return null;
}
// Does a hoop here sit against one already on the board? Asked of the square
// itself, not of what is marked on it: a hoop is normally placed on a square
// the player has already X-ed, and autoBlanks only reports empty squares.
function touchesHoop(c, before) {
  const x = c % P.W, y = (c / P.W) | 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= P.W || ny >= P.H) continue;
    if (before[ny * P.W + nx] === STAR) return true;
  }
  return false;
}
const hoopWord = n => n === 1 ? '1 hoop' : `${n} hoops`;

// One screen per rule, each explaining that rule in its own terms and offering
// only the help for it. Judged against the board as it stood before the move.
function ruleTrip(c, before) {
  if (!settings.auto && touchesHoop(c, before)) return {
    kind: 'touch', helper: 'auto', opt: 'optAuto',
    title: 'Hoops can never touch',
    note: 'No two hoops ever sit next to each other, side by side or corner to corner. '
        + 'That square touches a hoop you have already placed, so it can never hold one.',
    offer: 'Want every square around a hoop blanked out as you go?' };

  const rg = !settings.fillRegion && fullUnit(c, before, 'region');
  if (rg) return {
    kind: 'region', helper: 'fillRegion', opt: 'optFillRegion',
    title: P.k === 1 ? 'That colour already has its hoop' : 'That colour already has its hoops',
    note: `Every colour on the board holds exactly ${hoopWord(P.k)}. This one is full already, `
        + 'so no other square inside it can take one.',
    offer: 'Want a colour blanked out once it is full?' };

  const ln = !settings.fillLine && fullUnit(c, before, 'line');
  if (ln) return {
    kind: 'line', helper: 'fillLine', opt: 'optFillLine',
    title: `That ${ln.kind} already has ${ln.target === 1 ? 'its hoop' : 'its hoops'}`,
    note: `The number at the edge is how many hoops this ${ln.kind} holds: ${hoopWord(ln.target)}. `
        + 'It has them already, so no other square along it can take one.',
    offer: 'Want a row or column blanked out once it is full?' };

  return null;
}
function offerHelper(c, before) {
  if (settings.quiet || solved || modalOpen()) return;
  const t = ruleTrip(c, before); if (!t) return;
  const all = trips(), seen = (all[t.kind] || 0) + 1;
  all[t.kind] = seen; saveTrips(all);
  if (seen % 3 !== 1) return;  // 1st, 4th, 7th, ... of that rule
  // Let the misplaced hoop land and turn red before covering the board.
  setTimeout(() => {
    if (!P || solved || modalOpen()) return;
    showModal(t.title, `${t.note} ${t.offer}`, [
      ['Yes, blank them out', true, () => {
        settings[t.helper] = true; saveSettings(); $(t.opt).checked = true;
        // Take the offending hoop off: the square it sits on is exactly the
        // kind the player has just asked to have blanked out.
        if (marks[c] === STAR) { snapshot(); change(() => { marks[c] = EMPTY; }); }
        draw(); }],
      ['No thanks', false, () => {}],
      ['Stop showing these', false, () => {
        settings.quiet = true; saveSettings(); $('optQuiet').checked = true; }, 'quietbtn']]);
  }, 450);
}

$('buildStamp').textContent = `Hoopla build ${BUILD}`;
$('gameCode').onclick = () => {
  const chip = $('gameCode'), text = `Hoopla ${P && P.code ? P.code : '\u2014'} \u00b7 build ${BUILD}`;
  const show = ok => { chip.dataset.copied = ok ? 'yes' : 'no'; chip.textContent = ok ? 'Copied' : 'Press \u2318C';
    setTimeout(() => { delete chip.dataset.copied; chip.textContent = P && P.code ? P.code : '\u2014'; }, 1400); };
  const fallback = () => show(copyText(text));
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => show(true), fallback);
  else fallback();
};
board.addEventListener('contextmenu', e => e.preventDefault());
board.addEventListener('pointerdown', e => { if (!P || solved) return; const c = cellAt(e);
  closeBar(); if (c < 0 || givenSet.has(c)) { draw(); return; }
  snapshot();
  const was = marks.slice();
  if (e.button === 2) { change(() => { marks[c] = marks[c] === STAR ? EMPTY : STAR; }); draw();
    if (marks[c] === STAR) offerHelper(c, was); return; }
  const next = nextState(c); change(() => { marks[c] = next; }); draw();
  if (next === STAR) offerHelper(c, was);
  drag = next === DOT ? { seen: new Set([c]) } : null; board.setPointerCapture(e.pointerId); });
board.addEventListener('pointermove', e => { if (!drag) return; const c = cellAt(e);
  if (c < 0 || drag.seen.has(c)) return; drag.seen.add(c); if (marks[c] === EMPTY && !autoSet.has(c)) { marks[c] = DOT; draw(); } });
const endDrag = () => { drag = null; };
board.addEventListener('pointerup', endDrag); board.addEventListener('pointercancel', endDrag);
function undo() { if (!history.length || solved) return; const prev = history.pop(); change(() => { marks.set(prev); }); closeBar(); draw(); }
$('undo').onclick = undo;
$('clear').onclick = () => { if (!P || solved) return; snapshot(); const fresh = Logic.startMarks(P); change(() => { marks.set(fresh); }); closeBar(); draw(); };
document.addEventListener('keydown', e => {
  if ($('game').hidden) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'h') showHint(); else if (k === 'c') showCheck(); else if (k === 'u') undo();
  else if (e.key === 'Escape') $('quit').click();
});

window.__puzzle = () => P; window.__marks = () => [...marks]; // for testing
renderPickers(); showPicker('menu');
})();
