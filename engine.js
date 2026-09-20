// ===== Puzzle engine: shapes, generator, solver =====
const Engine = (() => {
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(arr, r) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  // ---- shapes: return {W,H,mask} ----
  function connected4(W, H, mask) {
    const start = mask.indexOf(true); if (start < 0) return false;
    const seen = new Uint8Array(W * H), st = [start]; seen[start] = 1; let n = 1;
    while (st.length) { const c = st.pop(), x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const nc = ny * W + nx;
        if (mask[nc] && !seen[nc]) { seen[nc] = 1; n++; st.push(nc); } } }
    return n === mask.filter(Boolean).length;
  }
  const Shapes = {
    square(n) { return { W: n, H: n, mask: Array(n * n).fill(true) }; },
    rectangle(n) { const H = Math.round(n * 0.65); return { W: n, H, mask: Array(n * H).fill(true) }; },
    octagon(n) { // straight edges three cells long, corners cut on the diagonal
      const c = Math.max(1, Math.round((n - 3) / 2)), mask = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
        mask.push(x + y >= c && (n - 1 - x) + y >= c && x + (n - 1 - y) >= c && (n - 1 - x) + (n - 1 - y) >= c);
      return { W: n, H: n, mask };
    },
    blank(n) { return Shapes.square(n); }, // plain grid, used with regions switched off
    carved(n, r) { // a full grid with big blocked areas cut out of it, leaving corridors and bays
      for (let t = 0; t < 80; t++) {
        const W = n, H = n, mask = Array(W * H).fill(true), total = W * H;
        const blobs = 2 + Math.floor(r() * 2), want = Math.round(total * (0.22 + r() * 0.1));
        let removed = 0;
        for (let i = 0; i < blobs && removed < want; i++) {
          let x = Math.floor(r() * W), y = Math.floor(r() * H);
          const size = Math.round(want / blobs);
          for (let s = 0; s < size * 3 && removed < want; s++) {
            const a2 = y * W + x, b2 = (H - 1 - y) * W + (W - 1 - x);
            if (mask[a2]) { mask[a2] = false; removed++; }
            if (mask[b2]) { mask[b2] = false; removed++; }
            const d = ADJ4[Math.floor(r() * 4)]; const nx = x + d[0], ny = y + d[1];
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
            x = nx; y = ny;
          }
        }
        const cells = mask.filter(Boolean).length;
        if (cells >= total * 0.55 && connected4(W, H, mask)) return { W, H, mask };
      }
      return Shapes.square(n);
    },
  };
  function punchHoles(W, H, mask, r) { // blocked cells scattered through the board, kept point-symmetric
    const cells = mask.filter(Boolean).length, want = Math.max(2, Math.round(cells * 0.1));
    for (let t = 0; t < 120; t++) {
      const m = mask.slice(); let done = 0;
      for (let i = 0; i < want * 6 && done < want; i++) {
        const x = Math.floor(r() * W), y = Math.floor(r() * H), a = y * W + x, b = (H - 1 - y) * W + (W - 1 - x);
        if (!m[a] || !m[b]) continue; m[a] = false; m[b] = false; done += a === b ? 1 : 2;
      }
      if (done >= want && connected4(W, H, m)) return m;
    }
    return mask;
  }
  function crop({ W, H, mask }) { // trim empty edge rows/cols
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const nW = x1 - x0 + 1, nH = y1 - y0 + 1, m = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.push(mask[y * W + x]);
    return { W: nW, H: nH, mask: m };
  }
  const ADJ8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
  const ADJ4 = [[1,0],[-1,0],[0,1],[0,-1]];

  // ---- star placement ----
  function placeUniform(W, H, k, r) { // square: exactly k per row and col, no touching
    const stars = new Set(), colCnt = new Array(W).fill(0);
    let nodes = 0;
    function combos(y) { // random subsets of k columns, non-adjacent
      const res = [], cols = shuffle([...Array(W).keys()], r);
      function rec(start, pick) { if (res.length > 60) return;
        if (pick.length === k) { res.push([...pick]); return; }
        for (let i = start; i < cols.length; i++) { const c = cols[i];
          if (pick.some(p => Math.abs(p - c) <= 1)) continue; pick.push(c); rec(i + 1, pick); pick.pop(); } }
      rec(0, []); return res;
    }
    function rec(y) { if (++nodes > 20000) return false; if (y === H) return true;
      for (const cs of combos(y)) {
        if (cs.some(c => colCnt[c] >= k)) continue;
        if (cs.some(c => [-1, 0, 1].some(d => stars.has((y - 1) * W + c + d) && c + d >= 0 && c + d < W))) continue;
        // capacity: remaining rows must be able to fill each column
        cs.forEach(c => { colCnt[c]++; stars.add(y * W + c); });
        const rowsLeft = H - y - 1; let ok = true;
        for (let c = 0; c < W; c++) if (k - colCnt[c] > Math.ceil(rowsLeft / 2) + 0) { ok = false; break; }
        if (ok && rec(y + 1)) return true;
        cs.forEach(c => { colCnt[c]--; stars.delete(y * W + c); });
      }
      return false; }
    return rec(0) ? stars : null;
  }
  function placeFree(W, H, mask, S, r) { // any shape: S stars, no touching, spread out
    for (let t = 0; t < 300; t++) {
      const stars = new Set(), blocked = new Uint8Array(W * H);
      const cells = shuffle(mask.map((m, i) => m ? i : -1).filter(i => i >= 0), r);
      for (const c of cells) { if (stars.size >= S) break; if (blocked[c]) continue;
        stars.add(c); const x = c % W, y = (c / W) | 0; blocked[c] = 1;
        for (const [dx, dy] of ADJ8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) blocked[ny * W + nx] = 1; } }
      if (stars.size === S) return stars;
    }
    return null;
  }

  // ---- region growth ----
  function growRegions(W, H, mask, seedsList, r) { // seedsList: array of star cells, one region each
    const reg = new Int16Array(W * H).fill(-1), size = [];
    seedsList.forEach((c, i) => { reg[c] = i; size[i] = 1; });
    let frontier = true;
    while (frontier) { frontier = false;
      const cand = [];
      for (let c = 0; c < W * H; c++) { if (!mask[c] || reg[c] >= 0) continue;
        const x = c % W, y = (c / W) | 0, ns = [];
        for (const [dx, dy] of ADJ4) { const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && reg[ny * W + nx] >= 0) ns.push(reg[ny * W + nx]); }
        if (ns.length) cand.push([c, ns]); }
      if (!cand.length) break; frontier = true;
      // grow a random slice of the frontier, favouring small regions a little
      shuffle(cand, r);
      const take = Math.max(1, Math.floor(cand.length * 0.35));
      for (let i = 0; i < take; i++) { const [c, ns] = cand[i]; if (reg[c] >= 0) continue;
        ns.sort((a, b) => size[a] - size[b] + (r() - 0.5) * 6);
        reg[c] = ns[0]; size[ns[0]]++; }
    }
    return reg;
  }
  function regionAdjacency(W, H, reg, R) {
    const adj = Array.from({ length: R }, () => new Set());
    for (let c = 0; c < W * H; c++) { if (reg[c] < 0) continue; const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1,0],[0,1]]) { const nx = x + dx, ny = y + dy;
        if (nx < W && ny < H) { const o = reg[ny * W + nx]; if (o >= 0 && o !== reg[c]) { adj[reg[c]].add(o); adj[o].add(reg[c]); } } } }
    return adj;
  }
  function groupRegions(W, H, reg, R, k, r) { // merge regions into connected groups of k, one star each
    const adj = regionAdjacency(W, H, reg, R).map(s => shuffle([...s], r));
    const group = new Array(R).fill(-1); let g = 0, nodes = 0;
    function rec() {
      if (++nodes > 200000) return false;
      const start = group.findIndex(v => v < 0); if (start < 0) return true;
      const options = [];
      (function collect(members) {
        if (members.length === k) { options.push(members.slice()); return; }
        if (options.length > 40) return;
        const nbrs = new Set();
        for (const m of members) for (const o of adj[m]) if (group[o] < 0 && !members.includes(o)) nbrs.add(o);
        for (const o of shuffle([...nbrs], r)) collect(members.concat(o));
      })([start]);
      for (const members of options) { members.forEach(m => group[m] = g); g++;
        if (rec()) return true; members.forEach(m => group[m] = -1); g--; }
      return false;
    }
    if (!rec()) return null;
    const out = new Int16Array(W * H).fill(-1);
    for (let c = 0; c < W * H; c++) if (reg[c] >= 0) out[c] = group[reg[c]];
    return out;
  }
  // ---- solver: finds up to `limit` solutions ----
  function solve(p, limit = 2, nodeLimit = 3e6) {
    const { W, H, mask, region, rowT, colT, k, R } = p;
    const cells = []; for (let c = 0; c < W * H; c++) if (mask[c]) cells.push(c);
    const rowRem = new Int16Array(H), colRem = new Int16Array(W), regRem = new Int16Array(R);
    for (const c of cells) { rowRem[(c / W) | 0]++; colRem[c % W]++; regRem[region[c]]++; }
    const rowCnt = new Int16Array(H), colCnt = new Int16Array(W), regCnt = new Int16Array(R);
    const star = new Uint8Array(W * H); const sols = []; let nodes = 0, aborted = false;
    // quick infeasibility
    for (let y = 0; y < H; y++) if (rowT[y] > rowRem[y]) return { sols, nodes, aborted };
    for (let x = 0; x < W; x++) if (colT[x] > colRem[x]) return { sols, nodes, aborted };
    function ok(y, x, g) { return rowCnt[y] + rowRem[y] >= rowT[y] && colCnt[x] + colRem[x] >= colT[x] && regCnt[g] + regRem[g] >= k; }
    function rec(i) {
      if (sols.length >= limit) return; if (++nodes > nodeLimit) { aborted = true; return; }
      if (i === cells.length) { sols.push(cells.filter(c => star[c])); return; }
      const c = cells[i], x = c % W, y = (c / W) | 0, g = region[c];
      rowRem[y]--; colRem[x]--; regRem[g]--;
      // try star
      if (rowCnt[y] < rowT[y] && colCnt[x] < colT[x] && regCnt[g] < k &&
          !(x > 0 && star[c - 1]) && !(y > 0 && (star[c - W] || (x > 0 && star[c - W - 1]) || (x < W - 1 && star[c - W + 1])))) {
        star[c] = 1; rowCnt[y]++; colCnt[x]++; regCnt[g]++;
        if (ok(y, x, g)) rec(i + 1);
        star[c] = 0; rowCnt[y]--; colCnt[x]--; regCnt[g]--;
        if (sols.length >= limit || aborted) { rowRem[y]++; colRem[x]++; regRem[g]++; return; }
      }
      if (ok(y, x, g)) rec(i + 1);
      rowRem[y]++; colRem[x]++; regRem[g]++;
    }
    rec(0);
    return { sols, nodes, aborted };
  }

  function regionConnectedWithout(W, H, reg, g, removed) {
    const cells = []; for (let c = 0; c < W * H; c++) if (reg[c] === g && c !== removed) cells.push(c);
    if (!cells.length) return false;
    const inR = new Set(cells), seen = new Set([cells[0]]), st = [cells[0]];
    while (st.length) { const c = st.pop(), x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of ADJ4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx; if (inR.has(nc) && !seen.has(nc)) { seen.add(nc); st.push(nc); } } }
    return seen.size === cells.length;
  }

  // ---- main generator ----
  const SIZES = {
    square:    { 1: [6, 8],  2: [8, 10] },
    rectangle: { 1: [8, 10], 2: [10, 12] },
    octagon:   { 1: [9, 13], 2: [11, 13] },
    carved:    { 1: [9, 11], 2: [11, 12] },
    blank:     { 1: [8, 10], 2: [8, 10] },
  };
  function generate({ shape = 'square', k = 1, size = 0, holes = false, regions = true, seed = Date.now() } = {}) {
    const r = rng(seed), t0 = Date.now();
    const n = arguments[0].n || SIZES[shape][k][size ? 1 : 0];
    let attempts = 0, repairsTotal = 0;
    for (;;) {
      attempts++;
      if (Date.now() - t0 > 500) return null;
      let { W, H, mask } = shape === 'carved' ? Shapes.carved(n, r) : Shapes[shape](n);
      if (holes) mask = punchHoles(W, H, mask, r);
      ({ W, H, mask } = crop({ W, H, mask }));
      const uniform = shape === 'square' && !holes && regions;
      let stars;
      if (uniform) stars = placeUniform(W, H, k, r);
      else { const cellsN = mask.filter(Boolean).length;
        let S = Math.round(cellsN * (regions ? (k === 1 ? 0.13 : 0.17) : cellsN <= 70 ? 0.13 : 0.09));
        S -= S % k; if (S < k) continue; stars = placeFree(W, H, mask, S, r); }
      if (!stars) continue;
      const starList = [...stars];
      let region, R;
      if (regions) {
        region = growRegions(W, H, mask, starList, r); R = starList.length;
        if (k > 1) { region = groupRegions(W, H, region, R, k, r); if (!region) continue; R = R / k; }
      } else { region = new Int16Array(W * H).fill(-1); for (let c = 0; c < W * H; c++) if (mask[c]) region[c] = 0; R = 1; }
      const rowT = new Array(H).fill(0), colT = new Array(W).fill(0);
      for (const c of starList) { rowT[(c / W) | 0]++; colT[c % W]++; }
      const p = { W, H, mask, region, rowT, colT, k: regions ? k : starList.length, R, uniform, regions,
        solution: starList.slice().sort((a, b) => a - b), givens: [] };
      let good = false;
      for (let rep = 0; rep < 80; rep++) {
        const res = solve(p, 2, 4e6);
        if (res.aborted) break;
        if (res.sols.length === 1) { good = true; break; }
        const truth = new Set(p.solution);
        const alt = res.sols.find(s => s.length !== truth.size || s.some(c => !truth.has(c)));
        if (!alt) break;
        if (!regions) { // no regions to reshape, so pin down a star the other solution disagrees about
          const cand = shuffle(p.solution.filter(c => !alt.includes(c) && !p.givens.includes(c)), r);
          if (!cand.length || p.givens.length > p.solution.length * 0.6) break;
          for (const c of cand.slice(0, 2)) p.givens.push(c);
          repairsTotal++; continue;
        }
        const cand = shuffle(alt.filter(c => !truth.has(c)), r);
        let moved = false;
        for (const c of cand) { const x = c % W, y = (c / W) | 0, g = region[c];
          const ns = shuffle(ADJ4.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < W && ny < H)
            .map(([nx, ny]) => region[ny * W + nx]).filter(o => o >= 0 && o !== g), r);
          if (!ns.length) continue;
          if (!regionConnectedWithout(W, H, region, g, c)) continue;
          region[c] = ns[0]; moved = true; repairsTotal++; break; }
        if (!moved) break;
      }
      if (!good) continue;
      const fin = solve(p, 2, 4e6);
      p.stats = { ms: Date.now() - t0, attempts, repairs: repairsTotal, effort: fin.nodes };
      return p;
    }
  }
  return { generate, solve, SIZES, Shapes };
})();
if (typeof module !== 'undefined') module.exports = Engine;
