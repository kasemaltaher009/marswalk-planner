/* A* route finding on the cost grid. */
import { BLOCKED } from './grid.js';
import { MinHeap } from './heap.js';

/** How costly one metre of a cell is, for a route priority p (0 = fastest, 100 = safest).
 *  Safest uses the cost grid as is (steep + sandy = expensive).
 *  Fastest uses how much the ground slows you down (same rule as the time estimate).
 *  Both are ≥ 1, so the A* heuristic below stays valid.
 *  Returns a table: weight = table[cost of the cell]. */
export function weightTable(p) {
  const w = p / 100, t = new Float32Array(256);
  for (let c = 1; c < 255; c++) t[c] = (1 - w) * (1 + (c - 1) / 100) + w * c;
  return t;
}

const weightTables = new Map();   // priority → table (they never change, so build each once)
export function weightsFor(p) {
  if (!weightTables.has(p)) weightTables.set(p, weightTable(p));
  return weightTables.get(p);
}

// The 8 neighbours of a cell: row and column offsets
const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];

// Work arrays, reused between searches (allocating 1 M-cell arrays every time is slow)
let scratch = null;

/** Cheapest path from cell s to cell t, or null if t can't be reached.
 *  Step cost = step length (m) × average weight of the two cells (`weights` from weightTable).
 *  Blocked cells are never entered, and a diagonal step may not cut the corner of a blocked cell.
 *  Returns {path: [cell indices from s to t], cost}. */
export function astar(grid, s, t, weights) {
  const { W, H, cost, cell } = grid;
  const N = W * H;
  if (!scratch || scratch.N !== N) {
    scratch = { N, gScore: new Float64Array(N), cameFrom: new Int32Array(N), closed: new Uint8Array(N) };
  }
  const { gScore, cameFrom, closed } = scratch;
  gScore.fill(Infinity); cameFrom.fill(-1); closed.fill(0);

  const tr = Math.floor(t / W), tc = t % W;
  // Octile distance × cheapest possible weight (1) → never overestimates, so A* stays optimal.
  const h = (i) => {
    const dr = Math.abs(Math.floor(i / W) - tr), dc = Math.abs((i % W) - tc);
    return cell * (Math.max(dr, dc) + (Math.SQRT2 - 1) * Math.min(dr, dc));
  };
  const open = new MinHeap();
  gScore[s] = 0;
  open.push(h(s), s);

  while (open.size) {
    const i = open.pop();
    if (i === t) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const r = Math.floor(i / W), c = i % W;
    for (let k = 0; k < 8; k++) {
      const nr = r + DR[k], nc = c + DC[k];
      if (nr < 0 || nr >= H || nc < 0 || nc >= W) continue;
      const j = nr * W + nc;
      if (cost[j] === BLOCKED || closed[j]) continue;
      const diag = DR[k] !== 0 && DC[k] !== 0;
      if (diag && (cost[r * W + nc] === BLOCKED || cost[nr * W + c] === BLOCKED)) continue; // don't cut cliff corners
      const g = gScore[i] + (diag ? Math.SQRT2 : 1) * cell * (weights[cost[i]] + weights[cost[j]]) / 2;
      if (g < gScore[j]) { gScore[j] = g; cameFrom[j] = i; open.push(g + h(j), j); }
    }
  }
  if (!Number.isFinite(gScore[t])) return null;
  const path = [];
  for (let i = t; i !== -1; i = cameFrom[i]) path.push(i);
  return { path: path.reverse(), cost: gScore[t] };
}
