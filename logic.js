// ===== Game logic: marks, automatic blanks, hints, scoring (UI-free, ports to Swift) =====
const Logic = (() => {
  const EMPTY = 0, DOT = 1, STAR = 2, START = 3;
  function units(P) { // rows, columns, regions as lists of cells with targets
    const { W, H, mask, region, rowT, colT, k, R } = P, u = [];
    for (let y = 0; y < H; y++) { const cells = []; for (let x = 0; x < W; x++) if (mask[y * W + x]) cells.push(y * W + x); if (cells.length) u.push({ kind: 'row', idx: y, cells, target: rowT[y] }); }
    for (let x = 0; x < W; x++) { const cells = []; for (let y = 0; y < H; y++) if (mask[y * W + x]) cells.push(y * W + x); if (cells.length) u.push({ kind: 'column', idx: x, cells, target: colT[x] }); }
    const rg = Array.from({ length: R }, () => []); for (let c = 0; c < W * H; c++) if (region[c] >= 0) rg[region[c]].push(c);
    rg.forEach((cells, g) => u.push({ kind: 'region', idx: g, cells, target: k }));
    return u;
  }
  function neighbours(P, c) { const { W, H, mask } = P, x = c % W, y = (c / W) | 0, out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < W && ny < H && mask[ny * W + nx]) out.push(ny * W + nx); }
    return out; }
  function startMarks(P) { // rows/cols that need 0 stars start blanked
    const m = new Uint8Array(P.W * P.H);
    for (const u of units(P)) if (u.target === 0) for (const c of u.cells) m[c] = START;
    for (const c of P.givens || []) m[c] = STAR;
    return m; }
  function autoBlanks(P, marks, opts) { // derived, so removing a star removes its blanks
    const s = new Set();
    if (opts.around) for (let c = 0; c < marks.length; c++) if (marks[c] === STAR) for (const n of neighbours(P, c)) if (marks[n] === EMPTY) s.add(n);
    // opts.region covers rule 1, opts.line rules 2: each is offered separately.
    for (const u of P.units) {
      if (!(u.kind === 'region' ? opts.region : opts.line)) continue;
      let n = 0; for (const c of u.cells) if (marks[c] === STAR) n++;
      if (n === u.target && u.target > 0) for (const c of u.cells) if (marks[c] === EMPTY) s.add(c); }
    return s; }

  const noun = u => u.kind === 'region' ? 'region' : u.kind;
  const stars = n => n === 1 ? '1 hoop' : `${n} hoops`;

  // Hints: first point out mistakes, then find the simplest logical step, else give a star.
  function hint(P, marks, autoSet) {
    const sol = new Set(P.solution);
    for (let c = 0; c < marks.length; c++) if (marks[c] === STAR && !sol.has(c))
      return { kind: 'mistake', level: 0, cells: [c], text: 'This hoop is in the wrong place. Take it off and look again.', apply: [[c, EMPTY]] };
    for (let c = 0; c < marks.length; c++) if ((marks[c] === DOT || marks[c] === START) && sol.has(c))
      return { kind: 'mistake', level: 0, cells: [c], text: 'This cell is X-ed out, but it could still hold a hoop. Clear it.', apply: [[c, EMPTY]] };

    const isStar = c => marks[c] === STAR;
    const open = c => P.mask[c] && marks[c] === EMPTY && !autoSet.has(c);
    const blankHint = (cells, focus, text, level = 1) => ({ kind: 'blank', level, cells: focus, targets: cells, text, apply: cells.map(c => [c, DOT]) });

    // 1. cells touching a star
    for (let c = 0; c < marks.length; c++) if (isStar(c)) { const t = neighbours(P, c).filter(open);
      if (t.length) return blankHint(t, [c], 'Hoops never touch, not even diagonally, so the open cells around this one can be X-ed out.'); }
    const info = P.units.map(u => { const have = u.cells.filter(isStar).length, av = u.cells.filter(open); return { u, need: u.target - have, av }; });
    // 2. finished units
    for (const { u, need, av } of info) if (need === 0 && av.length)
      return blankHint(av, u.cells, `This ${noun(u)} already has its ${stars(u.target)}, so everything else in it is empty.`);
    // 3. exactly as many open cells as stars needed
    for (const { u, need, av } of info) if (need > 0 && av.length === need)
      return { kind: 'star', level: 1, cells: u.cells, targets: av, text: `This ${noun(u)} still needs ${stars(need)} and has only ${av.length === 1 ? 'one open cell' : av.length + ' open cells'} left.`, apply: av.map(c => [c, STAR]) };
    // 4. a region squeezed into one row/column (and the reverse)
    for (const a of info) for (const b of info) {
      if (a === b || a.need <= 0 || a.need !== b.need || a.u.kind === b.u.kind) continue;
      if (!(a.u.kind === 'region' || b.u.kind === 'region')) continue;
      const bSet = new Set(b.u.cells);
      if (a.av.length && a.av.every(c => bSet.has(c))) { const aSet = new Set(a.av), t = b.av.filter(c => !aSet.has(c));
        if (t.length) return blankHint(t, a.u.cells.concat(b.u.cells),
          `Every open cell in this ${noun(a.u)} sits inside the highlighted ${noun(b.u)}. Both need ${stars(a.need)}, so ${a.need === 1 ? 'that star comes' : 'those stars come'} from the shared cells and the rest of the ${noun(b.u)} is empty.`, 2); }
    }
    // 5. what-if: a star here leaves some row, column or region without room (with a short chain of forced moves)
    const openCells = []; for (let c = 0; c < marks.length; c++) if (open(c)) openCells.push(c);
    const base = marks.map((v, c) => v === STAR ? STAR : (P.mask[c] && !open(c)) ? DOT : v);
    for (const depth of [0, 1, 4]) for (const c of openCells) {
      const bad = tryStar(P, base, c, depth);
      if (bad) return blankHint([c], [c, ...bad.cells], depth === 0
        ? `If a hoop went here, it would block too many cells in the highlighted ${noun(bad)}, leaving no room for its hoops. So this cell is empty.`
        : `If a hoop went here, the moves it forces would leave the highlighted ${noun(bad)} without room for its hoops. So this cell is empty.`, depth === 0 ? 3 : depth === 1 ? 4 : 5);
    }
    // 6. fallback
    const miss = P.solution.filter(c => !isStar(c));
    if (miss.length) { const c = miss[0];
      return { kind: 'star', level: 6, cells: [c], targets: [c], text: 'No quick step stands out here, so here is one hoop to keep you moving.', apply: [[c, STAR]] }; }
    return null;
  }

  function fits(P, cells, need) { // can `need` non-touching stars fit in these cells?
    if (need <= 0) return true; if (cells.length < need) return false;
    const [c, ...rest] = cells, nb = new Set(neighbours(P, c));
    return fits(P, rest.filter(x => !nb.has(x)), need - 1) || fits(P, rest, need);
  }
  function tryStar(P, base, c, depth) { // returns the unit that breaks, or null
    const m = base.slice(); const place = x => { m[x] = STAR; for (const n of neighbours(P, x)) { if (m[n] === STAR) return false; m[n] = DOT; } return true; };
    if (!place(c)) return null;
    for (let round = 0; round <= depth; round++) {
      let changed = false;
      for (const u of P.units) { const have = u.cells.filter(x => m[x] === STAR).length, av = u.cells.filter(x => m[x] === EMPTY), need = u.target - have;
        if (need < 0 || !fits(P, av, need)) return u;
        if (round < depth) { if (need === 0 && av.length) { av.forEach(x => m[x] = DOT); changed = true; }
          else if (need > 0 && av.length === need) { for (const x of av) if (m[x] === EMPTY && !place(x)) return u; changed = true; } }
      }
      if (!changed && round < depth) break;
    }
    return null;
  }
  // Difficulty: solve with hints only and record the hardest step needed.
  function grade(P) {
    if (!P.units) P.units = units(P);
    const m = startMarks(P); let maxLevel = 0, steps = 0; const byLevel = {};
    for (;;) { const h = hint(P, m, new Set()); if (!h) break; steps++;
      byLevel[h.level] = (byLevel[h.level] || 0) + 1;
      maxLevel = Math.max(maxLevel, h.level); for (const [c, v] of h.apply) m[c] = v; if (steps > 400) break; }
    return { maxLevel, steps, byLevel, difficulty: levelName(maxLevel) };
  }
  // Par: walk the same solving trace a person would follow and cost each deduction plus the taps it takes.
  const THINK = { 1: 1.2, 2: 3, 3: 4.5, 4: 8, 5: 13, 6: 20 }; // seconds of thinking per step, by how hard the step is
  const TAP = 1.1, SETUP = 6; // seconds per star placed, and a look at the board before starting
  function parFromTrace(P) {
    const g = P.grade || grade(P), find = P.solution.length - (P.givens || []).length;
    let think = 0; for (const lvl in g.byLevel) think += THINK[lvl] * g.byLevel[lvl];
    return Math.round((SETUP + think + TAP * find) / 5) * 5;
  }
  const SHAPE_CODES = { square: 'SQ', rectangle: 'RC', octagon: 'OC', carved: 'CV', blank: 'BL' };
  const DIFF_CODES = { easy: 'E', medium: 'M', hard: 'H' };
  function code(o, seed) { return `${SHAPE_CODES[o.shape]}${o.k}${o.size ? 'B' : 'S'}${DIFF_CODES[o.difficulty]}${o.holes ? 'H' : ''}${o.regions === false ? 'N' : ''}-${(seed >>> 0).toString(36)}`; }
  function parseCode(str) {
    const m = /^([A-Z]{2})([12])([SB])([EMH])(H?)(N?)-([0-9a-z]+)$/i.exec((str || '').trim()); if (!m) return null;
    const shape = Object.keys(SHAPE_CODES).find(k => SHAPE_CODES[k] === m[1].toUpperCase());
    const difficulty = Object.keys(DIFF_CODES).find(k => DIFF_CODES[k] === m[4].toUpperCase());
    if (!shape || !difficulty) return null;
    return { shape, k: Number(m[2]), size: m[3].toUpperCase() === 'B' ? 2 : 0, difficulty,
      holes: m[5].toUpperCase() === 'H', regions: m[6].toUpperCase() !== 'N', seed: parseInt(m[7], 36) };
  }
  const RANGES = { easy: [0, 3], medium: [4, 4], hard: [5, 6] };
  const levelName = l => l <= 3 ? 'easy' : l === 4 ? 'medium' : 'hard';
  // Build a puzzle at the requested difficulty. Too hard: pre-place a few stars ("givens"). Too easy: try another.
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // Same options and seed always give the same board, so two people can play an identical puzzle.
  // The builder runs one attempt at a time, so it can be used straight through or spread over idle moments.
  const BUILD_WORK = 30e6;
  function makeBuilder(Engine, opts) {
    const blank = opts.shape === 'blank';
    if (blank || opts.regions === false) opts = { ...opts, k: 1 }; // without regions, stars per region means nothing
    const genShape = blank ? 'blank' : opts.shape, genRegions = blank ? false : opts.regions !== false;
    const [lo, hi] = RANGES[opts.difficulty];
    const seed = opts.seed === undefined ? (Math.random() * 2 ** 31) | 0 : opts.seed, rnd = rng(seed);
    // blocked cells are texture the generator adds to some boards, never a switch the player flips.
    // The roll happens either way so that replaying a puzzle code follows the same random stream.
    const holeRoll = rnd() < 0.28;
    if (opts.holes === undefined) opts = { ...opts, holes: holeRoll };
    let best = null, bestDist = Infinity, attempts = 0;
    const t0 = Date.now(), meter = { work: 0 };
    return {
      get best() { return best; },
      // Stops on work done, never on time, so a slow phone builds exactly the board
      // a fast one does, only later. BUILD_WORK is about the old 1.2s budget on a
      // recent Mac. With nothing found yet it keeps going, up to eight times that:
      // a seed that finds nothing now finds nothing on every device, so giving up
      // early would mean no daily for anyone. Only two setups ever need it (big
      // blank, big two-hoop carved), measured at up to ~7s on a Mac.
      done() { return bestDist === 0 || (best && attempts >= 40) || (best && bestDist <= 1 && attempts >= 12)
        || meter.work > BUILD_WORK * (best ? 1 : 8); },
      finish() {
        if (!best) return null;
        best.stats.ms = Date.now() - t0; best.difficulty = best.grade.difficulty; best.asked = opts.difficulty;
        best.seed = seed; best.code = code(opts, seed); return best;
      },
      step() {
        attempts++;
        const P = Engine.generate({ shape: genShape, k: opts.k, size: opts.size, holes: !!opts.holes,
          regions: genRegions, seed: (rnd() * 2 ** 31) | 0, meter });
        if (!P) return;
        P.units = units(P); P.size = opts.size; P.difficulty = opts.difficulty; P.givens = P.givens || [];
        let g = grade(P);
        const maxGivens = Math.max(1, Math.floor(P.solution.length * 0.35));
        while (g.maxLevel > hi && P.givens.length < maxGivens) {
          const left = P.solution.filter(c => !P.givens.includes(c));
          P.givens.push(left[Math.floor(rnd() * left.length)]); g = grade(P);
        }
        const dist = g.maxLevel < lo ? lo - g.maxLevel : g.maxLevel > hi ? g.maxLevel - hi : 0;
        P.grade = g;
        if (dist < bestDist || (dist === bestDist && best && P.givens.length < best.givens.length)) { best = P; bestDist = dist; }
      },
    };
  }
  function build(Engine, opts) {
    const b = makeBuilder(Engine, opts);
    while (!b.done()) b.step();
    return b.finish();
  }
  // Same work, yielding between attempts so the page stays responsive while it builds the next puzzle ahead of time.
  function buildAsync(Engine, opts, done) {
    const b = makeBuilder(Engine, opts);
    (function loop() {
      if (b.done()) return done(b.finish());
      b.step();
      setTimeout(loop, 0);
    })();
  }
  // A day's puzzle: the same board for everyone, with the week ramping up like a crossword.
  const WEEK = [
    { shape: 'square',    k: 1, size: 0, difficulty: 'easy' },     // Sunday
    { shape: 'square',    k: 1, size: 0, difficulty: 'medium' },
    { shape: 'octagon',   k: 1, size: 0, difficulty: 'medium' },
    { shape: 'blank',     k: 1, size: 2, difficulty: 'medium' },
    { shape: 'carved',    k: 1, size: 2, difficulty: 'hard' },
    { shape: 'rectangle', k: 2, size: 0, difficulty: 'medium' },
    { shape: 'square',    k: 2, size: 2, difficulty: 'hard' },     // Saturday
  ];
  // The daily rolls over at midnight in New York, for everyone, wherever they are.
  // Reading the device's own midnight would hand players in different timezones
  // different boards on the same date. No time server is involved: the device clock
  // is already kept accurate by the OS, and the only thing that needed fixing was
  // which timezone the date gets read in. Change DAILY_TZ to 'UTC' to move the reset.
  const DAILY_TZ = 'America/New_York';
  const TZ_FMT = new Intl.DateTimeFormat('en-US', { timeZone: DAILY_TZ, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  // What the zone's wall clock reads at this instant.
  function zoneParts(date) {
    const o = {};
    for (const p of TZ_FMT.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
    if (o.hour === 24) o.hour = 0; // some engines render midnight as hour 24
    return o;
  }
  // How far that wall clock sits from UTC right now, daylight saving included.
  function zoneOffsetMs(date) {
    const p = zoneParts(date);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
      - Math.floor(date.getTime() / 1000) * 1000;
  }
  // The instant at which the zone's clock reads midnight on the given date. The offset
  // shifts across a daylight saving boundary, so resolve twice: the second pass uses the
  // offset in force at the answer rather than the one in force now.
  function zoneMidnight(y, m, d) {
    const wall = Date.UTC(y, m - 1, d);
    let t = wall;
    for (let i = 0; i < 2; i++) t = wall - zoneOffsetMs(new Date(t));
    return t;
  }
  function dailyKey(date = new Date()) {
    const p = zoneParts(date);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }
  // When today's board gives way to tomorrow's, as an instant.
  function nextDailyReset(date = new Date()) {
    const p = zoneParts(date);
    return new Date(zoneMidnight(p.year, p.month, p.day + 1));
  }
  function msUntilDailyReset(date = new Date()) {
    return Math.max(0, nextDailyReset(date).getTime() - date.getTime());
  }
  function dailyOptions(date = new Date()) {
    const key = dailyKey(date);
    let h = 2166136261; for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    // Take the weekday from the key, so the label can never disagree with the board.
    const weekday = new Date(key + 'T00:00:00Z').getUTCDay();
    return { ...WEEK[weekday], holes: (h >>> 7) % 4 === 0, seed: h >>> 0, day: key, weekday };
  }
  // Four rungs the player picks from. Each moves size, star count and reasoning depth together.
  const RUNGS = [
    { key: 'gentle', label: 'Gentle', setups: [
      { k: 1, size: 0, difficulty: 'easy' }, { k: 1, size: 0, difficulty: 'easy', holes: true }] },
    { key: 'steady', label: 'Steady', setups: [
      { k: 1, size: 2, difficulty: 'easy' }, { k: 1, size: 0, difficulty: 'medium' }, { k: 1, size: 2, difficulty: 'medium' }] },
    { key: 'tricky', label: 'Tricky', setups: [
      { k: 2, size: 0, difficulty: 'medium' }, { k: 1, size: 2, difficulty: 'hard' }, { k: 2, size: 0, difficulty: 'hard', holes: true }] },
    { key: 'brutal', label: 'Brutal', setups: [
      { k: 2, size: 2, difficulty: 'hard' }, { k: 2, size: 2, difficulty: 'hard', holes: true }, { k: 2, size: 0, difficulty: 'hard' }] },
  ];
  const PICKER_SHAPES = ['square', 'rectangle', 'octagon', 'carved'];
  function rungOptions(rungKey, shape, rnd = Math.random) {
    const rung = RUNGS.find(r => r.key === rungKey) || RUNGS[0];
    const setup = rung.setups[Math.floor(rnd() * rung.setups.length)];
    const s = shape && shape !== 'random' ? shape : PICKER_SHAPES[Math.floor(rnd() * PICKER_SHAPES.length)];
    return { shape: s, holes: false, ...setup, rung: rung.key };
  }

  function toJSON(P) {
    return { W: P.W, H: P.H, mask: P.mask.map(Boolean), region: Array.from(P.region), rowT: P.rowT, colT: P.colT,
      k: P.k, R: P.R, uniform: !!P.uniform, regions: P.regions !== false, solution: P.solution, givens: P.givens,
      grade: P.grade, stats: P.stats, difficulty: P.difficulty, asked: P.asked, size: P.size, code: P.code, daily: P.daily || null };
  }
  function fromJSON(o) { const P = { ...o, region: Int16Array.from(o.region) }; P.units = units(P); return P; }

  // Scoring is a golf score in seconds: your time plus penalties, measured against par.
  function level(P) { return (P.size ? 1 : 0) + (P.difficulty === 'medium' ? 1 : P.difficulty === 'hard' ? 2 : 0); }
  function costs(P) { const L = level(P); return { extraStar: 1 + L, reveal: 2 + L, hint: 10 + 5 * L }; }
  function result(P, seconds, hints, extraStars, reveals) {
    const c = costs(P), hintCost = hints * c.hint, extraCost = extraStars * c.extraStar, revealCost = reveals * c.reveal;
    const penalty = hintCost + extraCost + revealCost, final = seconds + penalty, p = parFromTrace(P);
    return { costs: c, hintCost, extraCost, revealCost, penalty, final, par: p, vsPar: final - p };
  }
  // Check: which of the player's own marks are wrong right now (automatic blanks follow from stars, so they are not counted)
  function wrongCells(P, marks) {
    const sol = new Set(P.solution), out = [];
    for (let c = 0; c < marks.length; c++) if ((marks[c] === STAR && !sol.has(c)) || (marks[c] === DOT && sol.has(c))) out.push(c);
    return out;
  }
  return { EMPTY, DOT, STAR, START, units, startMarks, autoBlanks, hint, grade, build, buildAsync, dailyOptions, dailyKey, nextDailyReset, msUntilDailyReset, DAILY_TZ, WEEK, RUNGS, PICKER_SHAPES, rungOptions, toJSON, fromJSON, code, parseCode, level, costs, par: parFromTrace, parFromTrace, result, wrongCells };
})();
if (typeof module !== 'undefined') module.exports = Logic;
