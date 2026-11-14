/* Unit tests for the routing core (web/js/routing/). Plain Node, nothing to install:
 *
 *     node --test web/tests/
 *
 * Tiny hand-made grids check A*, the weights, the visiting order and the walk stats;
 * the last test checks A* on the real cost_grid.json still gives the same path as before the refactor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildGrid, cellAt, rcOf, nearestWalkable, BLOCKED } from '../js/routing/grid.js';
import { MinHeap } from '../js/routing/heap.js';
import { astar, weightTable, weightsFor } from '../js/routing/astar.js';
import { bestRoute, permutations, routeLegs } from '../js/routing/planner.js';
import { routeStats, FLAT_SPEED_KMH } from '../js/routing/stats.js';

const CELL = 5;   // metres, like the real grid
const BOUNDS = { north: 1, south: 0, west: 0, east: 1 };

/** A grid from rows of text: '.' = cost 1, '#' = blocked, a digit d = cost 10·d (sandy/steep).
 *  `elev` (optional) = elevation in metres per cell, same layout. */
function makeGrid(rows, elev = null) {
  const H = rows.length, W = rows[0].length;
  const cost = [], elev_dm = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    cost.push(ch === '.' ? 1 : ch === '#' ? BLOCKED : 10 * Number(ch));
    elev_dm.push(elev ? elev[r][c] * 10 : 0);
  }));
  return buildGrid({ width: W, height: H, cell_m: CELL, cost, elev_dm }, BOUNDS);
}
const at = (g, r, c) => r * g.W + c;
const SAFEST = weightsFor(100);

// A simple, slow but obviously-correct Dijkstra, to check A* finds the cheapest cost.
function dijkstraCost(g, s, t, wt) {
  const N = g.W * g.H, dist = new Float64Array(N).fill(Infinity), done = new Uint8Array(N);
  dist[s] = 0;
  for (;;) {
    let i = -1;
    for (let j = 0; j < N; j++) if (!done[j] && dist[j] < Infinity && (i < 0 || dist[j] < dist[i])) i = j;
    if (i < 0) return Infinity;
    if (i === t) return dist[t];
    done[i] = 1;
    const [r, c] = rcOf(g, i);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if ((!dr && !dc) || nr < 0 || nr >= g.H || nc < 0 || nc >= g.W) continue;
      const j = at(g, nr, nc);
      if (g.cost[j] === BLOCKED) continue;
      if (dr && dc && (g.cost[at(g, r, nc)] === BLOCKED || g.cost[at(g, nr, c)] === BLOCKED)) continue;
      const d = dist[i] + (dr && dc ? Math.SQRT2 : 1) * g.cell * (wt[g.cost[i]] + wt[g.cost[j]]) / 2;
      if (d < dist[j]) dist[j] = d;
    }
  }
}

// ---------------------------------------------------------------------------
test('MinHeap pops keys in increasing order', () => {
  const h = new MinHeap();
  [5, 1, 4, 1, 9, 2, 6].forEach((k, i) => h.push(k, `v${i}`));
  const keys = [];
  while (h.size) { const top = h.keys[0]; h.pop(); keys.push(top); }
  assert.deepEqual(keys, [1, 1, 2, 4, 5, 6, 9]);
});

test('grid: cell ↔ lat/lon and slope', () => {
  const g = makeGrid(['...', '...'], [[0, 5, 10], [0, 5, 10]]);
  assert.equal(cellAt(g, 0.99, 0.01), 0);          // north-west corner
  assert.equal(cellAt(g, 0.01, 0.99), at(g, 1, 2)); // south-east corner
  assert.equal(cellAt(g, 1.5, 0.5), -1);           // outside
  assert.deepEqual(rcOf(g, 5), [1, 2]);
  // 5 m rise per 5 m cell → 45°
  assert.ok(Math.abs(g.slope[at(g, 0, 1)] - 45) < 1e-4);
  assert.equal(g.blockedPct, 0);
});

test('nearestWalkable moves a blocked click to the closest walkable cell', () => {
  const g = makeGrid(['.###', '####', '####']);
  assert.equal(nearestWalkable(g, at(g, 0, 0), 20), at(g, 0, 0));   // already walkable
  assert.equal(nearestWalkable(g, at(g, 1, 1), 20), at(g, 0, 0));
  assert.equal(nearestWalkable(g, at(g, 2, 3), 2), null);            // nothing within 2 cells
});

// ---------------------------------------------------------------------------
test('A*: open ground → straight diagonal, cost = length', () => {
  const g = makeGrid(['.....', '.....', '.....', '.....', '.....']);
  const res = astar(g, at(g, 0, 0), at(g, 4, 4), SAFEST);
  assert.deepEqual(res.path, [0, 6, 12, 18, 24]);
  assert.ok(Math.abs(res.cost - 4 * Math.SQRT2 * CELL) < 1e-9);
});

test('A*: goes round a wall through the gap', () => {
  const g = makeGrid([
    '.....',
    '####.',
    '.....',
  ]);
  const res = astar(g, at(g, 0, 0), at(g, 2, 0), SAFEST);
  assert.ok(res.path.includes(at(g, 1, 4)), 'path uses the gap');
  for (const i of res.path) assert.notEqual(g.cost[i], BLOCKED);
});

test('A*: no corner-cutting between two blocked cells, and unreachable → null', () => {
  const g = makeGrid(['.#', '#.']);
  assert.equal(astar(g, at(g, 0, 0), at(g, 1, 1), SAFEST), null);
  // one blocked corner is enough to forbid the diagonal step
  const g2 = makeGrid(['.#', '..']);
  assert.deepEqual(astar(g2, at(g2, 0, 0), at(g2, 1, 1), SAFEST).path, [0, 2, 3]);
});

test('A*: detours around expensive ground when that is cheaper, and matches Dijkstra', () => {
  const g = makeGrid([
    '.......',
    '.99999.',
    '.99999.',
    '.......',
  ]);
  const s = at(g, 1, 0), t = at(g, 1, 6);
  const res = astar(g, s, t, SAFEST);
  for (const i of res.path) assert.equal(g.cost[i], 1, 'stays on cost-1 ground');
  assert.ok(Math.abs(res.cost - dijkstraCost(g, s, t, SAFEST)) < 1e-9);
});

test('A*: optimal on a random grid for several priorities (checked against Dijkstra)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const rows = Array.from({ length: 14 }, () => Array.from({ length: 14 }, () => {
    const x = rnd();
    return x < 0.2 ? '#' : x < 0.5 ? String(1 + Math.floor(rnd() * 9)) : '.';
  }).join(''));
  rows[0] = '.' + rows[0].slice(1);
  rows[13] = rows[13].slice(0, 13) + '.';
  const g = makeGrid(rows);
  for (const p of [0, 30, 100]) {
    const res = astar(g, 0, g.W * g.H - 1, weightsFor(p));
    const best = dijkstraCost(g, 0, g.W * g.H - 1, weightsFor(p));
    if (best === Infinity) assert.equal(res, null);
    else assert.ok(Math.abs(res.cost - best) < 1e-9, `priority ${p}`);
  }
});

// ---------------------------------------------------------------------------
test('weightTable: safest = the cost itself, fastest = slow-down factor, never below 1', () => {
  const safest = weightTable(100), fastest = weightTable(0), mid = weightTable(50);
  for (let c = 1; c < 255; c++) {
    assert.ok(Math.abs(safest[c] - c) < 1e-4);
    assert.ok(Math.abs(fastest[c] - (1 + (c - 1) / 100)) < 1e-5);
    assert.ok(Math.abs(mid[c] - (safest[c] + fastest[c]) / 2) < 1e-4);
    assert.ok(fastest[c] >= 1 && safest[c] >= 1);
  }
  assert.equal(weightsFor(40), weightsFor(40), 'tables are cached');
});

// ---------------------------------------------------------------------------
test('permutations: every order exactly once', () => {
  const p = permutations([1, 2, 3]);
  assert.equal(p.length, 6);
  assert.equal(new Set(p.map(String)).size, 6);
  assert.deepEqual(permutations([]), [[]]);
});

test('bestRoute: picks the cheapest visiting order', () => {
  // A corridor: targets numbered far, near, middle from the start at the west end.
  const g = makeGrid(['..........']);
  const cells = [at(g, 0, 0), at(g, 0, 9), at(g, 0, 3), at(g, 0, 6)];
  const opts = { priority: 100, returnToStart: false, cache: new Map() };

  const best = bestRoute(g, cells, { ...opts, bestOrder: true });
  assert.deepEqual(best.seq, [0, 2, 3, 1]);                 // near → middle → far
  assert.equal(best.path.length, 10);
  assert.deepEqual(best.stopAt, [{ point: 2, pos: 3 }, { point: 3, pos: 6 }, { point: 1, pos: 9 }]);
  assert.deepEqual(best.legs.map((l) => [l.fromPoint, l.toPoint, l.from, l.to]), [[0, 2, 0, 3], [2, 3, 3, 6], [3, 1, 6, 9]]);

  const asNumbered = bestRoute(g, cells, { ...opts, bestOrder: false });
  assert.deepEqual(asNumbered.seq, [0, 1, 2, 3]);
  assert.ok(asNumbered.path.length > best.path.length);

  const back = bestRoute(g, cells, { ...opts, bestOrder: true, returnToStart: true });
  assert.equal(back.seq.at(-1), 0);
  assert.equal(back.path.at(-1), cells[0]);
});

test('bestRoute: null when a target is cut off', () => {
  const g = makeGrid(['..#..']);
  assert.equal(bestRoute(g, [0, 4], { priority: 100, bestOrder: true, returnToStart: true, cache: new Map() }), null);
});

test('routeLegs: colours cycle and legs chain together', () => {
  const legs = routeLegs([{ point: 1, pos: 4 }, { point: 0, pos: 9 }]);
  assert.deepEqual(legs.map((l) => [l.from, l.to, l.fromPoint, l.toPoint]), [[0, 4, 0, 1], [4, 9, 1, 0]]);
  assert.notEqual(legs[0].color, legs[1].color);
});

// ---------------------------------------------------------------------------
test('routeStats: flat firm ground walks at 3 km/h', () => {
  const g = makeGrid(['....']);
  const s = routeStats(g, [0, 1, 2, 3]);
  assert.equal(s.total, 15);
  assert.equal(s.up, 0);
  assert.equal(s.roughPct, 0);
  assert.ok(Math.abs(s.walkHours - 0.015 / FLAT_SPEED_KMH) < 1e-12);
});

test('routeStats: climb, descent, grade, diagonal steps and rough ground', () => {
  const g = makeGrid(['.33', '...'], [[0, 1, 2], [0, 0, 0]]);
  const s = routeStats(g, [at(g, 1, 0), at(g, 0, 1), at(g, 0, 2)]);
  assert.ok(Math.abs(s.total - (Math.SQRT2 + 1) * CELL) < 1e-9);   // one diagonal + one straight step
  assert.equal(s.up, 2);
  assert.equal(s.down, 0);
  assert.ok(Math.abs(s.maxGradeDeg - Math.atan(2 / s.total) * 180 / Math.PI) < 1e-9);
  // rough = average cost of a step's two cells over 25: step 1 averages (1+30)/2, step 2 is 30
  assert.ok(Math.abs(s.roughPct - 100 * CELL / s.total) < 1e-9);
  // slower than flat firm ground
  assert.ok(s.walkHours > s.total / 1000 / FLAT_SPEED_KMH);
});

// ---------------------------------------------------------------------------
// Regression on the real data: recorded with the original app.js before the refactor.
const DATA = fileURLToPath(new URL('../data/', import.meta.url));
test('real cost_grid.json: same paths as before the refactor', { skip: !existsSync(DATA + 'cost_grid.json') && 'no data' }, () => {
  const config = JSON.parse(readFileSync(DATA + 'config.json'));
  const g = buildGrid(JSON.parse(readFileSync(DATA + 'cost_grid.json')), config.bounds);
  const W = g.W;
  assert.equal(g.blockedPct.toFixed(4), '19.7129');
  const expected = [
    // [start, goal, priority, path length, cost, distance (m)]
    [500 * W + 500, 200 * W + 300, 100, 395, '52750.140841', '2301.3708'],
    [500 * W + 500, 200 * W + 300, 50, 361, '27725.017553', '2172.7922'],
    [500 * W + 500, 200 * W + 300, 0, 303, '2517.739299', '1961.4928'],
    [500 * W + 500, 800 * W + 750, 100, 363, '80150.626561', '2220.0714'],
    [400 * W + 600, 650 * W + 350, 0, 401, '3260.202886', null],
  ];
  for (const [s, t, p, len, cost, dist] of expected) {
    const res = astar(g, s, t, weightsFor(p));
    assert.equal(res.path.length, len, `length ${s}→${t} at ${p}`);
    assert.equal(res.cost.toFixed(6), cost);
    if (dist) assert.equal(routeStats(g, res.path).total.toFixed(4), dist);
  }
  assert.equal(astar(g, 100 * W + 100, 900 * W + 900, weightsFor(100)), null);   // cut off
});
