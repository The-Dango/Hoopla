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
let pickerView = 'menu', settingsFrom = null; // where the gear was pressed
function showPicker(view = 'menu') {
  if (tutorial) endTutorial();
  $('dialog').classList.remove('show', 'blur'); $('game').classList.remove('dialog-up');
  if (view !== 'settings') settingsFrom = null;
  pickerView = view;
  $('game').hidden = true; $('picker').hidden = false;
  for (const [id, key] of [['viewMenu','menu'],['viewPick','pick'],['viewOwn','own'],['viewLearn','learn'],['viewSettings','settings']]) $(id).hidden = key !== view;
  if (view === 'menu') renderMenu();
  prefetch();
}
function showGame() { stopCountdown(); settingsFrom = null; $('picker').hidden = true; $('game').hidden = false; }
$('menuPick').onclick = () => showPicker('pick');
$('menuOwn').onclick = () => showPicker('own');
// The gear goes straight to settings from wherever it is pressed, and the gear
// again, or Back, returns to exactly that place: a picker view, or the board
// mid-puzzle with the clock picked up where it left off.
function openSettings(from) {
  if (settingsFrom) return closeSettings(); // pressing it again backs out
  settingsFrom = from;
  if (from === 'game') pauseClock();
  showPicker('settings');
}
function closeSettings() {
  const from = settingsFrom; settingsFrom = null;
  if (from === 'game' && P && !solved) { showGame(); resumeClock(); return; }
  showPicker(from && from !== 'game' ? from : 'menu');
}
$('gearBtn').onclick = () => openSettings(pickerView);
$('gameGear').onclick = () => openSettings('game');
$('setBack').onclick = closeSettings;
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
  $('menuNote').textContent = 'Everyone gets the same daily board. It changes at midnight Lake Ontario time.';
}
// ---------- the tutorial ----------
// A board built by hand for teaching, then frozen: every player gets it in the same
// colours. From a fixed start, every move has exactly one square the rules allow, so
// the tutorial can ring it and say why without a player ever having a real choice:
//   1  a colour that is a single square (every colour holds one hoop)
//   2  the squares around that hoop are out (never touch): a colour left with one
//   3  full rows and columns are out too: another colour left with one
//   4  a column needs its hoop, and every other square in it is out
//   5  a colour whose other squares all touch a hoop or share its row or column
//   6  the last hoop, which the player finds unaided
// Checked with Engine.solve (exactly one solution), Logic.grade (every step level 1)
// and a separate walk of the chain (one option at every move, each rule needed at
// least once). Each blanking helper switches itself on the moment the player places
// the hoop that used its rule, and the next stage says so.
let tutorial = null;
const TUT_BOARD = {
  W: 6, H: 6, k: 1, R: 6, uniform: true, regions: true,
  mask: Array(36).fill(true),
  region: [0,2,1,1,1,3, 2,2,1,1,1,3, 4,2,1,3,3,3, 4,4,1,3,3,5, 5,4,4,3,3,5, 5,5,5,5,5,5],
  rowT: [1,1,1,1,1,1], colT: [1,1,1,1,1,1],
  solution: [0, 9, 13, 22, 26, 35],
  givens: [],
  grade: { maxLevel: 1, steps: 18, byLevel: { 1: 18 }, difficulty: 'easy' },
  difficulty: 'easy', asked: 'easy', size: 0, code: null, daily: null,
};
// The squares in the order the board forces them.
const MOVES = [0, 13, 26, 9, 22, 35];
function cellsWhere(f) { const out = []; for (let c = 0; c < P.W * P.H; c++) if (P.mask[c] && f(c)) out.push(c); return out; }
const colourOf = c => cellsWhere(d => P.region[d] === P.region[c]);
const columnOf = c => cellsWhere(d => d % P.W === c % P.W);
// A move: ring its square, light the unit it completes and the hoops that explain it.
// `enables` is the helper that switches on once this hoop is down.
function tutMove(i, text, note, unit, enables) {
  return { text, note, enables, ring: () => [MOVES[i]], context: () => [...unit(MOVES[i]), ...MOVES.slice(0, i)],
    done: () => marks[MOVES[i]] === STAR };
}
const HELPER_OPT = { auto: 'optAuto', fillRegion: 'optFillRegion', fillLine: 'optFillLine' };
// What each helper offers when a real game's reminder asks, in one place.
const HELPER_ASK = {
  auto: 'Want every square around a hoop blanked out as you go?',
  fillRegion: 'Want a colour blanked out once it is full?',
  fillLine: 'Want a row or column blanked out once it is full?' };

const STAGES = [
  tutMove(0, 'Every colour holds exactly one hoop, and this one is a single square. Tap it twice: once for an X, again for a hoop.',
    'A square goes empty, then X, then hoop, then empty again.', colourOf),
  tutMove(1, 'Hoops never touch, not even at the corners, so the squares around yours are out. That leaves this colour one square.',
    'Tap it twice for a hoop.', colourOf, 'auto'),
  tutMove(2, 'Each row and column holds the number at its edge, one here, so a row or column with its hoop is out. That leaves this colour one square.',
    'From now on the squares around every hoop blank out for you.', colourOf, 'fillLine'),
  tutMove(3, 'This column needs its hoop too, and every other square in it touches a hoop or shares a row with one.',
    'Full rows and columns now blank out for you too.', columnOf, 'fillRegion'),
  tutMove(4, 'Once a colour has its hoop, the rest of it is out as well. Every other square of this colour is out already: one square left.',
    'Full colours now blank out for you too.', colourOf),
  { text: 'One hoop left. You know everything you need to find it.',
    note: 'The buttons below are yours now. The blanking can be switched off under the gear.',
    free: true,
    done: () => P.solution.every(c => marks[c] === STAR) },
];

function showStage() {
  const st = STAGES[tutorial.i];
  if (!st) return tutDone();
  // A hoop put down ahead of its turn: nothing to wait for.
  if (st.done && st.done()) return tutAdvance(st);
  if (st.free) $('game').classList.remove('guided');
  const ring = st.ring ? st.ring() : [];
  curHint = ring.length
    ? { targets: ring, cells: [...ring, ...(st.context ? st.context() : [])], kind: 'star' }
    : null;
  draw();
  const [text, buttons, note] = stageBar(st);
  showBar(text, '', buttons, note);
}
// What a stage's bar says. Every stage waits on a hoop, so none can leave the player stuck.
function stageBar(st) { return [st.text, [], st.note]; }
// The bar sits above the board and the stages say different amounts, so the board
// would shift up and down as they change. Hold the bar at the height of the longest
// thing it can say, a stage or a "hold on", measured on a hidden copy that is gone
// again before anything is drawn.
function tutBarFloor() {
  const bar = $('hintBar'); if (!tutorial || $('game').hidden) return;
  const probe = bar.cloneNode(true);
  probe.removeAttribute('id'); probe.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
  probe.className = 'bar'; probe.hidden = false; probe.style.visibility = 'hidden'; probe.style.minHeight = '';
  bar.after(probe);
  let tall = 0;
  const bars = [...STAGES.map(stageBar), mistakeBar('colour'), mistakeBar('column'), mistakeBar(null)];
  for (const [text, buttons, note] of bars) {
    probe.querySelector('.bartext p').textContent = text; probe.querySelector('.barnote').textContent = note || '';
    barButtons(probe.querySelector('.barbtns'), buttons);
    tall = Math.max(tall, probe.getBoundingClientRect().height); }
  probe.remove();
  bar.style.minHeight = tall ? Math.ceil(tall) + 'px' : '';
}
window.addEventListener('resize', tutBarFloor);
// A stage's hoop is down: switch on the helper its rule has just taught, then move on.
function tutAdvance(st) {
  if (st.enables && !settings[st.enables]) {
    settings[st.enables] = true; saveSettings(); $(HELPER_OPT[st.enables]).checked = true; }
  if (tutorial.i === STAGES.length - 1) return tutDone();
  tutNext();
}
function tutNext() { tutorial.i++; showStage(); }
function tutProgress() {
  if (!tutorial) return;
  const st = STAGES[tutorial.i];
  if (!tutSecondThoughts()) return; // a wrong hoop is worth saying so at any stage
  if (st && st.done && st.done()) tutAdvance(st);
}
// The first unit that can no longer be filled: its hoops plus the squares still
// able to take one fall short of its count. Squares are counted as blocked for
// every reason at once, whatever helpers the player has switched on, because
// this is about what is true on the board rather than what is drawn on it.
function tutStranded() {
  const blocked = Logic.autoBlanks(P, marks, { around: true, region: true, line: true });
  for (const u of P.units) {
    let hoops = 0, open = 0;
    for (const c of u.cells) {
      if (marks[c] === STAR) hoops++;
      else if (marks[c] === EMPTY && !blocked.has(c)) open++; }
    if (hoops + open < u.target) return { what: u.kind === 'region' ? 'colour' : u.kind, cells: u.cells }; }
  return null;
}
// Only the tutorial board is frozen with a known solution, so only here can the
// game tell a legal-but-wrong hoop from a right one for free. In a real game
// that answer is what Check is for, and it costs time; none of this runs there.
// Returns false while a wrong hoop is down, which also holds the finish back.
function tutSecondThoughts() {
  const sol = new Set(P.solution), wrong = [];
  for (let c = 0; c < marks.length; c++) if (marks[c] === STAR && !sol.has(c)) wrong.push(c);
  if (!wrong.length) { if (tutorial.said) { tutorial.said = null; showStage(); } return true; }
  const key = wrong.join(',');
  if (tutorial.said === key) return false;
  if (analyse().bad.size) return false; // a rule is actually broken: the reminder already covers it
  tutorial.said = key;
  const s = tutStranded(), ring = s ? s.cells.filter(c => marks[c] !== STAR) : [];
  curHint = ring.length ? { targets: ring, cells: [...s.cells, ...wrong], kind: 'mistake' }
                        : { targets: wrong, cells: wrong, kind: 'mistake' };
  draw();
  const [text, buttons, note] = mistakeBar(ring.length ? s.what : null);
  showBar(text, 'bad', buttons, note);
  return false;
}
// "Leave it" keeps the hoop and goes back to the lesson in hand, rather than
// closing the bar, which would drop the board by the bar's whole height.
function mistakeBar(what) {
  const buttons = [['Take it back', true, () => { undo(); showStage(); }], ['Leave it', false, showStage]];
  return what
    ? [`Hold on \u2014 that leaves the ringed ${what} nowhere to put a hoop.`, buttons,
       'No rule is broken yet, which is why nothing lit up \u2014 the board simply cannot be finished from here.']
    : ['Hold on \u2014 that is not where this one goes.', buttons,
       'Every colour, every row and every column still needs exactly one hoop.'];
}
function tutDone() {
  curHint = null; solved = true; clearInterval(timerId); draw(true);
  const on = ['auto', 'fillRegion', 'fillLine'].filter(k => settings[k]).length;
  $('winTitle').textContent = 'That is the whole game';
  $('winScore').innerHTML = `<dd class="note">${on === 3
    ? 'The three helpers stay on, so the board keeps itself tidy while you think. They are under the gear if you would rather mark squares by hand.'
    : on ? 'The other helpers are under the gear whenever you want them.'
         : 'The helpers are all under the gear if you change your mind.'}</dd>`;
  $('winStep').hidden = true;
  $('winMenu').hidden = true;
  $('winNew').textContent = 'Go cause a Hoopla';
  $('win').classList.add('show'); confetti();
}
function startTutorial() {
  tutorial = { i: 0, said: null };
  lastOpts = { opts: { shape: 'square', k: 1, size: 0, difficulty: 'easy' }, key: null, source: 'own' };
  showGame(); clearSaved(); closeBar();
  $('game').classList.add('tut', 'guided');
  $('gameTitle').textContent = 'How to play';
  $('gameCode').hidden = true;
  $('note').textContent = '';
  $('win').classList.remove('show');
  $('busy').classList.remove('show'); $('board').style.opacity = 1;
  P = Logic.fromJSON(JSON.parse(JSON.stringify(TUT_BOARD)));
  marks = Logic.startMarks(P);
  givenSet = new Set();
  history = []; placements = 0; placedAt = new Map();
  hints = 0; shows = 0; solved = false; gaveUp = false; revealed = false; curHint = null;
  elapsed = 0;
  colorRegions(); buildBoard(); renderRules(); renderDev(); renderCounts();
  tutBarFloor();
  showStage();
}
function endTutorial() {
  tutorial = null;
  $('hintBar').style.minHeight = '';
  $('game').classList.remove('tut', 'guided');
  $('gameCode').hidden = false;
}

// ---------- how to play ----------
// Small hand-built boards rather than generated ones: the generator starts at
// 6x6, and an example wants to be small enough to take in at a glance. They
// reuse drawHoop and drawX so a hoop here looks like a hoop in play.
const MC = 34; // cell size for the examples
function miniBoard(spec) {
  const { W, H, region = null, marks = {}, rowT = null, colT = null, bad = [] } = spec;
  const pad = (rowT || colT) ? 18 : 4;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${pad * 2 + W * MC} ${pad * 2 + H * MC}`);
  svg.setAttribute('width', pad * 2 + W * MC);
  svg.setAttribute('height', pad * 2 + H * MC);
  svg.setAttribute('aria-hidden', 'true');
  const cells = el('g', {}, svg), grid = el('g', {}, svg), mk = el('g', {}, svg), clue = el('g', {}, svg);
  let thin = '', thick = '';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x, X = pad + x * MC, Y = pad + y * MC;
    el('rect', { x: X, y: Y, width: MC, height: MC,
      fill: region ? `var(--r${region[c]})` : 'var(--blank)' }, cells);
    const g = region ? region[c] : 0;
    const rOf = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H) ? -2 : (region ? region[yy * W + xx] : 0);
    [[rOf(x + 1, y), `M${X + MC} ${Y}v${MC}`], [rOf(x, y + 1), `M${X} ${Y + MC}h${MC}`],
     [rOf(x - 1, y), `M${X} ${Y}v${MC}`], [rOf(x, y - 1), `M${X} ${Y}h${MC}`]]
      .forEach(([o, d], i) => { if (o === g) { if (i < 2) thin += d; } else if (i < 2 || o === -2) thick += d; });
  }
  el('path', { d: thin, stroke: 'var(--thin)', 'stroke-width': 1, fill: 'none' }, grid);
  el('path', { d: thick, stroke: 'var(--line)', 'stroke-width': 2.8, fill: 'none', 'stroke-linecap': 'square' }, grid);
  for (const k in marks) {
    const c = +k, X = pad + (c % W) * MC + MC / 2, Y = pad + ((c / W) | 0) * MC + MC / 2;
    if (marks[c] === 'x') drawX(mk, X, Y, .45);
    else {
      // drawHoop sizes itself for a 40px board cell; these are smaller.
      const g = drawHoop(mk, X, Y, bad.includes(c) ? 'wrong' : 'normal');
      g.setAttribute('transform', `scale(${MC / 46})`);
    }
  }
  const num = (t, X, Y) => el('text', { x: X, y: Y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    'font-size': 12, 'font-weight': 700, fill: 'var(--muted)' }, clue).textContent = t;
  if (rowT) rowT.forEach((t, y) => { num(t, pad / 2, pad + y * MC + MC / 2); num(t, pad * 1.5 + W * MC, pad + y * MC + MC / 2); });
  if (colT) colT.forEach((t, x) => { num(t, pad + x * MC + MC / 2, pad / 2); num(t, pad + x * MC + MC / 2, pad * 1.5 + H * MC); });
  return svg;
}
function renderLearn() {
  const put = (id, node, caption) => {
    const f = $(id); f.innerHTML = ''; f.appendChild(node);
    if (caption) { const c = document.createElement('figcaption'); c.textContent = caption; f.appendChild(c); }
  };
  // One square, through its three states.
  const cyc = $('learnCycle'); cyc.innerHTML = '';
  [['Empty', {}], ['Tap once', { 0: 'x' }], ['Tap again', { 0: 'hoop' }], ['And again', {}]]
    .forEach(([label, marks], i) => {
      if (i) { const a = document.createElement('span'); a.className = 'arrow'; a.textContent = '\u2192'; cyc.appendChild(a); }
      const f = document.createElement('figure');
      f.appendChild(miniBoard({ W: 1, H: 1, marks }));
      const c = document.createElement('figcaption'); c.textContent = label; f.appendChild(c);
      cyc.appendChild(f);
    });
  // Three colours, one hoop in each, the rest ruled out.
  put('learnRegion', miniBoard({ W: 3, H: 3,
    region: [0, 1, 1, 0, 2, 1, 2, 2, 2],
    marks: { 0: 'hoop', 2: 'hoop', 7: 'hoop' } }), 'One hoop in every colour');
  // Edge numbers.
  put('learnLine', miniBoard({ W: 3, H: 3, rowT: [1, 0, 1], colT: [1, 0, 1],
    marks: { 0: 'hoop', 8: 'hoop' } }), 'The 0 row and column stay empty');
  // Touching, and not.
  put('learnBad', miniBoard({ W: 3, H: 3, marks: { 0: 'hoop', 4: 'hoop' }, bad: [0, 4] }), 'Touching at the corner');
  put('learnGood', miniBoard({ W: 3, H: 3, marks: { 0: 'hoop', 2: 'hoop' } }), 'A square apart is fine');
}
$('menuLearn').onclick = () => { renderLearn(); showPicker('learn'); };
$('learnBack').onclick = () => showPicker('menu');
$('learnStart').onclick = startTutorial;

// Easier and Harder on the finish card, whenever "Another one" would carry on a run:
// a board exactly one step either side of the one just played, and the run carries on
// from there. A player saying so is a stronger signal than one board's time, so it
// moves a whole step where a finished board moves a third of one at most. The menu's
// own level is left alone. Neither shows past the end of the ladder.
function runGoesOn() { return !!lastOpts && (lastOpts.source === 'pick' || lastOpts.source === 'like') && chainSkill !== null; }
function playedStep() { return lastOpts.plan ? lastOpts.plan.step : Logic.nearestStep(lastOpts.opts); }
function renderWinStep() {
  const on = runGoesOn(), at = on ? playedStep() : 0;
  $('winStep').hidden = !on;
  $('winEasier').hidden = !on || at <= 0;
  $('winHarder').hidden = !on || at >= Logic.LADDER.length - 1;
}
function stepTo(delta) {
  const step = playedStep() + delta; startChain(step);
  const pl = Logic.stepPick(step, settings.pickShape);
  startPuzzle(pl.opts, planKey(pl), 'pick', pl);
}
$('winEasier').onclick = () => stepTo(-1);
$('winHarder').onclick = () => stepTo(1);
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
let nextUp = null, nextKey = null, nextOpts = null, building = false;
function ownOpts() { return { shape: settings.shape, k: settings.shape === 'blank' ? 1 : settings.k, size: settings.size,
  difficulty: settings.difficulty }; }
// Pick for me, once under way, fits itself to the player. Starting from the menu is
// always from scratch, at the level chosen there. Each "Another one" after that moves
// chainSkill, the player's position on the ladder for this run of boards, by how the
// last board went, and draws the next board around it. The menu's own level is never
// changed behind the player's back. nextPlan is the next board drawn, held so the one
// built ahead is the one handed out.
// The level shown for the run (chainLevel) is a little sticky: it only changes once the
// skill is a third of a step inside the new level, so a player on the line between two
// is not told "moving up" and "easing back" on alternate boards.
let chainSkill = null, chainLevel = null, nextPlan = null;
function startChain(skill) { chainSkill = skill; chainLevel = Logic.skillRung(skill); nextPlan = null; }
function plan() { if (!nextPlan) nextPlan = Logic.adaptPick(chainSkill, settings.pickShape); return nextPlan; }
function planKey(pl) { return optsKey({ step: pl.step, shape: pl.opts.shape }); }
function menuKey() { return optsKey({ rung: settings.rung, pickShape: settings.pickShape }); }
function startFromMenu() {
  startChain(Logic.rungSkill(settings.rung));
  const o = Logic.rungOptions(settings.rung, settings.pickShape);
  startPuzzle(o, menuKey(), 'pick', { step: Logic.nearestStep(o), lean: 0 });
}
function startNext() { const pl = plan(); nextPlan = null; startPuzzle(pl.opts, planKey(pl), 'pick', pl); }
// After a board in the run: move the skill by how it went. Returns { rung, up } when
// that changes the level, so the card can say so.
function learnFrom(r, gaveUp) {
  if (!lastOpts || lastOpts.source !== 'pick' || tutorial || chainSkill === null) return null;
  const step = lastOpts.plan ? lastOpts.plan.step : Logic.nearestStep(lastOpts.opts), from = chainSkill;
  chainSkill = Logic.adaptSkill(from, step, Logic.adaptOutcome(r ? r.final : 0, r ? r.par : 0, gaveUp));
  if (Math.round(chainSkill) !== Math.round(from)) nextPlan = null; // drawn for the old step
  const was = chainLevel, up = chainSkill > from, now = Logic.skillRung(chainSkill);
  if (now !== was && Logic.skillRung(chainSkill + (up ? -1 : 1) / 3) === now) chainLevel = now;
  return chainLevel !== was ? { rung: chainLevel, up } : null;
}
function optsKey(o) { return JSON.stringify(o); }
// "Another like this" after the daily: the daily's setup without its seed, so
// a fresh board of the same kind. It is an ordinary puzzle, not a second daily.
function likeOpts(o) { return { shape: o.shape, k: o.k, size: o.size, difficulty: o.difficulty, holes: !!o.holes }; }
function prefetch() { // build the likely next board quietly, in slices, while the player is busy
  if (building) return;
  // In a game the next board follows from where this one came from: a daily is followed
  // by one like it, and one like it by Pick for me. On the menu, by the screen showing.
  const src = $('picker').hidden && lastOpts ? lastOpts.source : null;
  const view = src === 'daily' ? 'like' : src === 'own' ? 'own' : src && chainSkill !== null ? 'next'
    : $('viewOwn').hidden === false ? 'own' : 'pick';
  const pl = view === 'next' ? plan() : null;
  const o = view === 'like' ? likeOpts(lastOpts.opts) : view === 'own' ? ownOpts() : view === 'next' ? pl.opts
    : Logic.rungOptions(settings.rung, settings.pickShape);
  const key = view === 'next' ? planKey(pl) : view === 'pick' ? menuKey() : optsKey(o);
  if (nextUp && nextKey === key) return;
  building = true;
  Logic.buildAsync(Engine, o, p => { building = false; if (p) { nextUp = p; nextKey = key; nextOpts = o; } });
}
function startPuzzle(opts, key, source, pl) {
  if (tutorial) endTutorial();
  lastOpts = { opts, key, source: source || (lastOpts && lastOpts.source) || 'own',
    plan: pl ? { step: pl.step, lean: pl.lean } : null };
  showGame(); clearSaved();
  $('busy').textContent = 'Building a puzzle…'; $('busy').classList.add('show');
  $('win').classList.remove('show'); $('board').style.opacity = .25; closeBar();
  if (nextUp && key && nextKey === key) { // the board built ahead: take its own setup, which a
    // menu start may have drawn differently within the same level
    const p = nextUp; lastOpts.opts = nextOpts;
    if (lastOpts.plan) lastOpts.plan.step = Logic.nearestStep(nextOpts);
    nextUp = null; nextKey = null; return begin(p, nextOpts); }
  setTimeout(() => begin(Logic.build(Engine, opts), opts), 30);
}
function begin(p, opts) {
  $('busy').classList.remove('show'); $('board').style.opacity = 1;
  if (!p) { $('busy').textContent = 'That combination did not build. Go back and try again.'; $('busy').classList.add('show'); return; }
  if (opts && opts.daily) p.daily = opts.daily;
  P = p; marks = Logic.startMarks(P); givenSet = new Set(P.givens); history = [];
  solved = false; revealed = false; gaveUp = false; hints = 0; placements = 0; placedAt = new Map(); shows = 0;
  colorRegions(); startTimer(0); buildBoard(); draw(); renderRules(); renderDev(); renderCounts(); renderNote(); renderPickers();
  setTimeout(prefetch, 600);
}
$('menuDaily').onclick = () => { const o = Logic.dailyOptions(); startPuzzle({ ...o, daily: o.day }, null, 'daily'); };
$('pickStart').onclick = startFromMenu;
$('ownStart').onclick = () => startPuzzle(ownOpts(), optsKey(ownOpts()), 'own');
$('winNew').onclick = () => {
  if (tutorial) return showPicker('menu');
  // After the daily, one like it; after that, a run of boards that fits itself to the
  // player, starting at the level nearest the daily's.
  if (lastOpts && lastOpts.source === 'daily') {
    startChain(Logic.nearestStep(lastOpts.opts));
    const o = likeOpts(lastOpts.opts); return startPuzzle(o, optsKey(o), 'like'); }
  if (lastOpts && (lastOpts.source === 'pick' || lastOpts.source === 'like')) return chainSkill === null ? startFromMenu() : startNext();
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
    hints, placements, shows, opts: lastOpts && lastOpts.opts, key: lastOpts && lastOpts.key, source: lastOpts && lastOpts.source,
    plan: lastOpts && lastOpts.plan, chain: chainSkill, level: chainLevel })); } catch (e) {}
  closeBar(); showPicker('menu');
}
$('resumeBtn').onclick = () => { const s = savedGame(); if (!s) return;
  showGame(); clearSaved();
  P = Logic.fromJSON(s.P); marks = Uint8Array.from(s.marks); givenSet = new Set(P.givens); history = [];
  solved = false; revealed = false; gaveUp = false; hints = s.hints || 0; placements = s.placements || 0; shows = s.shows || 0;
  placedAt = new Map(); lastOpts = s.opts ? { opts: s.opts, key: s.key, source: s.source, plan: s.plan || null } : null;
  chainSkill = typeof s.chain === 'number' ? s.chain : null; chainLevel = s.level || (chainSkill === null ? null : Logic.skillRung(chainSkill)); nextPlan = null;
  colorRegions(); startTimer(s.elapsed || 0); buildBoard(); draw(); renderRules(); renderDev(); renderCounts(); renderNote();
};
window.addEventListener('pagehide', () => { if (P && !solved && !$('game').hidden) pauseAndLeave(); });

// ---------- give up ----------
$('quit').onclick = () => {
  if (tutorial) return showPicker('menu');
  if (!P || solved) return showPicker('menu');
  closeBar();
  showModal('Back to the menu?',
    'Save the board to pick up later from the menu, or give up and see the answer.', [
    ['Save and go to menu', true, pauseAndLeave],
    ['Give up and see it', false, () => {
      gaveUp = true; revealed = true; solved = true; clearInterval(timerId);
      const moved = learnFrom(null, true);
      marks = Logic.startMarks(P); for (const c of P.solution) marks[c] = STAR; closeBar(); draw();
      if (P.daily) { try { localStorage.setItem(NSKEY + 'daily-' + P.daily, JSON.stringify({ gaveUp: true })); } catch (e) {} }
      $('winTitle').textContent = 'Here it is';
      $('winScore').innerHTML = `<dd class="note">No score for a puzzle you gave up on. Take a look at how it fits together.</dd>`
        + (moved ? `<dd class="note">${levelNews(moved)}</dd>` : '');
      renderWinStep();
      $('winMenu').hidden = false;
      $('winNew').textContent = P.daily ? 'Another like this' : 'Another one';
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
  if (lastOpts && lastOpts.source === 'pick' && lastOpts.plan && lastOpts.plan.lean > 0) parts.push('A step up from your usual, to stretch you.');
  if (g) parts.push(`${g === 1 ? '1 hoop is' : g + ' hoops are'} placed for you to start.`);
  $('note').textContent = parts.join(' ');
  $('gameTitle').textContent = P.daily ? 'Daily puzzle' : `${cap(P.difficulty)} · ${P.W}×${P.H}`;
  const chip = $('gameCode');
  chip.textContent = P.code || '—';
  chip.hidden = !P.code;
}
function renderRules() {
  const k = P.k, s = k === 1 ? 'hoop' : 'hoops', c = Logic.costs(P);
  const kc = $('gameK');
  kc.hidden = !P.regions; // a blank board has no colours to count against
  if (P.regions) {
    kc.setAttribute('aria-label', `${k} ${s} needed in every colour`);
    // var(--o), the colour a hoop is while the puzzle is unsolved. Gold is the
    // solved state, and this is a reminder of what to place, not of finishing.
    kc.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">`
      + `<circle cx="12" cy="12" r="7.6" fill="none" stroke="var(--o)" stroke-width="5"/>`
      + `<circle cx="12" cy="12" r="10.1" fill="none" stroke="var(--line)" stroke-width="1.6"/>`
      + `<circle cx="12" cy="12" r="5.1" fill="none" stroke="var(--line)" stroke-width="1.6"/></svg>`
      + `<span class="kfull">${k} per colour</span><span class="kshort">\u00d7 ${k}</span>`;
  }
  $('scoring').textContent = tutorial ? ''
    : `Target time ${fmt(Logic.par(P))}. Each extra hoop adds ${c.extraStar}s, each reveal ${c.reveal}s, each hint ${c.hint}s.`;
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
  // The palette is shuffled per board so the same shape is not always the same
  // colour — except in the tutorial, which is the one board everybody shares.
  const order = [...Array(R).keys()].sort((a, b) => adj[b].size - adj[a].size);
  const off = tutorial ? 0 : Math.floor(Math.random() * 10);
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
    el('rect', { x: X, y: Y, width: CS, height: CS, fill: P.regions ? `var(--r${colors[region[c]]})` : 'var(--blank)', class: 'cell' }, gCells);
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
function drawX(parent, X, Y, opacity, colour) {
  el('path', { d: `M${X - 8} ${Y - 8}l16 16M${X + 8} ${Y - 8}l-16 16`, stroke: colour || 'var(--dot)', 'stroke-width': 3.4,
    'stroke-linecap': 'round', opacity }, parent);
}
function analyse() {
  const { W, H, region, rowT, colT, k, R } = P;
  const rc = new Array(H).fill(0), cc = new Array(W).fill(0), gc = new Array(R).fill(0), bad = new Set();
  // Free cells: still empty, and not already blanked by a helper. A unit that can
  // no longer reach its count is as broken as one that has overshot it.
  const ro = new Array(H).fill(0), co = new Array(W).fill(0), go = new Array(R).fill(0);
  for (let c = 0; c < W * H; c++) { if (!P.mask[c]) continue;
    if (marks[c] === STAR) { rc[(c / W) | 0]++; cc[c % W]++; gc[region[c]]++; }
    else if (marks[c] === EMPTY && !autoSet.has(c)) { ro[(c / W) | 0]++; co[c % W]++; go[region[c]]++; } }
  for (let c = 0; c < W * H; c++) if (marks[c] === STAR) { const x = c % W, y = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && marks[ny * W + nx] === STAR) bad.add(c); }
    if (rc[y] > rowT[y] || cc[x] > colT[x] || gc[region[c]] > k) bad.add(c); }
  let done = bad.size === 0; for (let y = 0; y < H; y++) if (rc[y] !== rowT[y]) done = false;
  for (let x = 0; x < W; x++) if (cc[x] !== colT[x]) done = false; for (let g = 0; g < R; g++) if (gc[g] !== k) done = false;
  const starvedRow = y => rc[y] + ro[y] < rowT[y], starvedCol = x => cc[x] + co[x] < colT[x],
        starvedReg = g => gc[g] + go[g] < k;
  const rowBad = [], colBad = [];
  for (let y = 0; y < H; y++) rowBad[y] = rc[y] > rowT[y] || starvedRow(y);
  for (let x = 0; x < W; x++) colBad[x] = cc[x] > colT[x] || starvedCol(x);
  // Name the X's doing the starving: the player's own, which they can take back,
  // and the helpers' blanks, which show where the hoop that caused it reaches.
  const badX = new Set();
  for (let c = 0; c < W * H; c++) { if (!P.mask[c] || !(marks[c] === DOT || (marks[c] === EMPTY && autoSet.has(c)))) continue;
    if (starvedRow((c / W) | 0) || starvedCol(c % W) || starvedReg(region[c])) badX.add(c); }
  return { rc, cc, bad, badX, rowBad, colBad, done };
}
// Tapping twice for a hoop passes through an X, and that X alone can starve a
// row or a colour. Red that a fresh X brings on waits a moment, so a hoop on
// its way does not flash the board red first. Only what the X starves waits:
// red that was already up stays up, and a hoop that breaks a rule is red at once.
const HOLD_MS = 500;
let hold = null;
function holdRed() { endHold(false); const a = analyse(), p = P;
  hold = { P: p, badX: a.badX, rowBad: a.rowBad, colBad: a.colBad,
    timer: setTimeout(() => { hold = null; if (P === p && !$('game').hidden) draw(); }, HOLD_MS) }; }
function endHold(redraw = true) { if (!hold) return; clearTimeout(hold.timer); hold = null; if (redraw && P) draw(); }
function draw(winAnim) {
  const { W, H, rowT, colT } = P;
  // analyse() reads autoSet, so it has to be this move's set and not the last one's.
  autoSet = Logic.autoBlanks(P, marks, { around: settings.auto, region: settings.fillRegion, line: settings.fillLine });
  const a = analyse();
  if (hold && hold.P === P) { a.badX = new Set([...a.badX].filter(c => hold.badX.has(c)));
    a.rowBad = a.rowBad.map((b, y) => b && hold.rowBad[y]); a.colBad = a.colBad.map((b, x) => b && hold.colBad[x]); }
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
    else if (marks[c] === DOT) drawX(gMarks, X, Y, .9, settings.err && a.badX.has(c) ? 'var(--bad)' : null);
    else if (marks[c] === EMPTY && autoSet.has(c)) { const r = settings.err && a.badX.has(c); drawX(gMarks, X, Y, r ? .75 : .45, r ? 'var(--bad)' : null); }
    else if (marks[c] === STAR) {
      const badS = settings.err && a.bad.has(c), winState = solved && !revealed;
      if (givenSet.has(c) && !winState) el('circle', { cx: X, cy: Y, r: 20, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5, opacity: .3 }, gMarks);
      const g = drawHoop(gMarks, X, Y, badS ? 'wrong' : winState ? 'win' : 'normal');
      if (winAnim) { g.classList.add('star-win'); g.style.animationDelay = (((c % W) + ((c / W) | 0)) * 45) + 'ms'; } } }
  const clue = (x, y, t, n, broken) => { const over = n > t, full = n === t;
    el('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 17, 'font-weight': 700,
      fill: settings.err && broken ? 'var(--bad)' : 'var(--muted)', opacity: full && !over ? .35 : 1 }, gClues).textContent = t; };
  // Where a row or column crosses squares that are not on the board (octagon
  // corners, carved bays, holes), faint dots carry it across, so the eye can
  // follow a clue to its squares. Every dot sits on one lattice through the
  // square centres, so a row and a column crossing share a dot rather than
  // stacking two, and each colour is one path so nothing is drawn twice.
  // One weight everywhere; red only when broken.
  const GAP = 12, STEP = CS / 5, dots = new Map(); // "x,y" -> broken
  const leads = (on, n, broken, at) => {
    for (let i = 0; i < n; i++) { if (on[i]) continue; let j = i; while (j + 1 < n && !on[j + 1]) j++;
      const a0 = i === 0 ? M / 2 + GAP : M + i * CS + GAP, a1 = j === n - 1 ? M + n * CS + M / 2 - GAP : M + (j + 1) * CS - GAP;
      for (let t = M + CS / 2 + Math.ceil((a0 - M - CS / 2) / STEP) * STEP; t <= a1; t += STEP) {
        const k = at(t); dots.set(k, dots.get(k) || (settings.err && broken)); }
      i = j; } };
  for (let y = 0; y < H; y++) {
    const row = P.mask.slice(y * W, y * W + W); if (!row.some(Boolean)) continue; const Y = M + y * CS + CS / 2;
    leads(row, W, a.rowBad[y], t => `${t},${Y}`);
    clue(M / 2, Y, rowT[y], a.rc[y], a.rowBad[y]); clue(M + W * CS + M / 2, Y, rowT[y], a.rc[y], a.rowBad[y]); }
  for (let x = 0; x < W; x++) {
    const col = Array.from({ length: H }, (_, y) => P.mask[y * W + x]); if (!col.some(Boolean)) continue; const X = M + x * CS + CS / 2;
    leads(col, H, a.colBad[x], t => `${X},${t}`);
    clue(X, M / 2, colT[x], a.cc[x], a.colBad[x]); clue(X, M + H * CS + M / 2, colT[x], a.cc[x], a.colBad[x]); }
  for (const red of [false, true]) { let d = '';
    for (const [k, b] of dots) if (b === red) d += `M${k}h0`;
    if (d) el('path', { d, stroke: red ? 'var(--bad)' : 'var(--muted)', 'stroke-width': 2.4, 'stroke-linecap': 'round', class: 'lead' }, gClues); }
  drawHint();
  if (a.done && !solved && !tutorial) win();
}
function levelNews(m) {
  const label = (Logic.RUNGS.find(r => r.key === m.rung) || {}).label || m.rung;
  return m.up ? `You've been flying. Moving you up to ${label}.` : `Easing back to ${label} for a bit.`;
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
  $('winScore').innerHTML = `<dt>Time</dt><dd>${fmt(elapsed)}</dd>`
    + row('Hints', hints, c.hint, r.hintCost) + row('Extra hoops', extra, c.extraStar, r.extraCost) + row('Reveals', shows, c.reveal, r.revealCost)
    + `<dt class="total">Final</dt><dd class="total">${fmt(r.final)}</dd>`
    + `<dt>Target</dt><dd>${fmt(r.par)}</dd>`;
  const moved = learnFrom(r, false);
  if (moved) $('winScore').innerHTML += `<dd class="note">${levelNews(moved)}</dd>`;
  renderWinStep();
  // There is only one daily a day, so its way onward is a fresh board of the same kind.
  $('winMenu').hidden = false;
  $('winNew').textContent = P.daily ? 'Another like this' : 'Another one';
  if (P.daily) { try { localStorage.setItem(NSKEY + 'daily-' + P.daily, JSON.stringify({ final: r.final, time: elapsed })); } catch (e) {} }
  renderDev();
  setTimeout(() => { $('win').classList.add('show'); confetti(); }, 700);
}
// A handful of hoops thrown up over the finish card, in the hoop's two colours.
// Pure decoration: nothing reads it, and it clears itself away.
function confetti() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div'), cols = ['--o', '--sun'];
  box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 30; i++) { const e = document.createElement('i'), rnd = (a, b) => a + Math.random() * (b - a);
    e.style.cssText = `--x:${rnd(2, 96)}%;--s:${rnd(12, 24)}px;--c:var(${cols[i % cols.length]});--dx:${rnd(-90, 90)}px;`
      + `--r:${rnd(-540, 540)}deg;--t:${rnd(1.3, 2.1)}s;--d:${rnd(0, .4)}s`;
    box.appendChild(e); }
  document.body.appendChild(box); setTimeout(() => box.remove(), 2800);
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
  el('path', { d: scrim, 'fill-rule': 'evenodd', fill: 'var(--tray)', opacity: .72 }, gDim);
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
  barButtons($('barBtns'), buttons);
  revealBar(bar);
}
function barButtons(box, buttons) {
  box.innerHTML = '';
  for (const [label, primary, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; if (fn) b.onclick = fn; box.appendChild(b); }
}
// The bar sits above the board, so opening one pushes the board down and that
// movement is itself the signal that something appeared. It only reads as a
// signal if the bar is on screen, which on a big board it will not be: the press
// came from the toolbar, far below. So bring it into view — together with the
// cells the hint is ringing when the two fit, and otherwise the bar alone, which
// leaves the board below it to scroll down through.
function revealBar(bar) {
  const br = bar.getBoundingClientRect();
  let top = br.top, bottom = br.bottom;
  const cells = P && curHint && (curHint.targets || curHint.cells);
  if (cells && cells.length) {
    const svg = $('board'), r = svg.getBoundingClientRect(), sy = r.height / svg.viewBox.baseVal.height;
    for (const c of cells) bottom = Math.max(bottom, r.top + (M + (((c / P.W) | 0) + 1) * CS) * sy);
  }
  const lo = 12, hi = window.innerHeight - 12;
  if (bottom - top <= hi - lo) {
    if (bottom > hi) window.scrollBy(0, bottom - hi);
    else if (top < lo) window.scrollBy(0, top - lo);
  } else window.scrollBy(0, top - lo);
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
// Does the board differ from the last undo step at this square and nowhere else?
function tappedJustThis(c) { const top = history[history.length - 1];
  if (!top || top[c] === marks[c]) return false;
  for (let i = 0; i < marks.length; i++) if (i !== c && top[i] !== marks[i]) return false;
  return true; }
function snapshot() { history.push(marks.slice()); if (history.length > 300) history.shift(); }
function change(fn) { // every board change runs through here, so star placements are counted
  const before = marks.slice(); fn(); const now = Date.now();
  for (let c = 0; c < marks.length; c++) {
    if (marks[c] === STAR && before[c] !== STAR) { placements++; placedAt.set(c, now); }
    else if (before[c] === STAR && marks[c] !== STAR) { const t = placedAt.get(c);
      if (t !== undefined && now - t < GRACE_MS) placements--; placedAt.delete(c); } }
  renderCounts();
  tutProgress();
}
function nextState(c) { if (marks[c] === STAR) return EMPTY;
  if (marks[c] === DOT || marks[c] === START || autoSet.has(c)) return STAR; return DOT; }
let drag = null;
const DOUBLE_MS = 400; let hoopTap = null;
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
    offer: HELPER_ASK.auto };

  const rg = !settings.fillRegion && fullUnit(c, before, 'region');
  if (rg) return {
    kind: 'region', helper: 'fillRegion', opt: 'optFillRegion',
    title: P.k === 1 ? 'That colour already has its hoop' : 'That colour already has its hoops',
    note: `Every colour on the board holds exactly ${hoopWord(P.k)}. This one is full already, `
        + 'so no other square inside it can take one.',
    offer: HELPER_ASK.fillRegion };

  const ln = !settings.fillLine && fullUnit(c, before, 'line');
  if (ln) return {
    kind: 'line', helper: 'fillLine', opt: 'optFillLine',
    title: `That ${ln.kind} already has ${ln.target === 1 ? 'its hoop' : 'its hoops'}`,
    note: `The number at the edge is how many hoops this ${ln.kind} holds: ${hoopWord(ln.target)}. `
        + 'It has them already, so no other square along it can take one.',
    offer: HELPER_ASK.fillLine };

  return null;
}
function offerHelper(c, before) {
  if (settings.quiet || solved || modalOpen()) return;
  const t = ruleTrip(c, before); if (!t) return;
  const all = trips(), seen = (all[t.kind] || 0) + 1;
  // Tutorial breaks do not count towards the real game's tally, and there the
  // reminder comes back every single time: the point of the tutorial is to
  // learn the rule, not to be left in peace while playing.
  if (!tutorial) {
    all[t.kind] = seen; saveTrips(all);
    if (seen % 3 !== 1) return;  // 1st, 4th, 7th, ... of that rule
  }
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
// Right-click is the board's own "place a hoop", so the browser's menu stays shut over the
// whole board area. That includes the finish card: the tutorial shows it in the same
// press that places the last hoop, so the menu event lands on the card, not the board.
document.querySelector('.boardbox').addEventListener('contextmenu', e => e.preventDefault());
board.addEventListener('pointerdown', e => { if (!P || solved) return; const c = cellAt(e);
  if (!tutorial) closeBar();
  if (hold) endHold(false);
  if (c < 0 || givenSet.has(c)) { draw(); return; }
  const was = marks.slice();
  const next = e.button === 2 ? (marks[c] === STAR ? EMPTY : STAR) : nextState(c);
  // Double-tapping an X means "hoop here", but the cycle would run it on past
  // the hoop to empty. A tap that lands on a hoop this same square got a moment
  // ago is the second half of that double tap, so the hoop stays.
  if (e.button !== 2 && next === EMPTY && hoopTap && hoopTap.P === P && hoopTap.c === c
      && e.timeStamp - hoopTap.t < DOUBLE_MS) { hoopTap = null; return; }
  hoopTap = e.button !== 2 && next === STAR ? { P, c, t: e.timeStamp } : null;
  // Tap-tap for a hoop is one move, so it undoes as one: when the last thing
  // done was X-ing this very square, the hoop shares that X's undo step.
  if (!(next === STAR && tappedJustThis(c))) snapshot();
  if (e.button === 2) { change(() => { marks[c] = next; }); draw();
    if (marks[c] === STAR) offerHelper(c, was); return; }
  if (next === DOT) holdRed();
  change(() => { marks[c] = next; }); draw();
  if (next === STAR) offerHelper(c, was);
  drag = next === DOT ? { seen: new Set([c]) } : null; board.setPointerCapture(e.pointerId); });
board.addEventListener('pointermove', e => { if (!drag) return; const c = cellAt(e);
  if (c < 0 || drag.seen.has(c)) return; drag.seen.add(c); if (marks[c] === EMPTY && !autoSet.has(c)) { marks[c] = DOT; draw(); } });
const endDrag = () => { drag = null; };
board.addEventListener('pointerup', endDrag); board.addEventListener('pointercancel', endDrag);
function undo() { if (!history.length || solved) return; endHold(false); hoopTap = null; const prev = history.pop(); change(() => { marks.set(prev); }); closeBar(); draw(); }
$('undo').onclick = undo;
$('clear').onclick = () => { if (!P || solved) return; endHold(false); snapshot(); const fresh = Logic.startMarks(P); change(() => { marks.set(fresh); }); closeBar(); draw(); };
document.addEventListener('keydown', e => {
  if ($('game').hidden) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'h') showHint(); else if (k === 'c') showCheck(); else if (k === 'u') undo();
  else if (e.key === 'Escape') $('quit').click();
});

window.__puzzle = () => P; window.__marks = () => [...marks]; window.__chain = () => chainSkill; // for testing
renderPickers(); showPicker('menu');
})();
