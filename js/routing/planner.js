/* Multi-stop planning: the start plus up to 3 targets.
 * Every pair of points gets an A* leg (cached); then every visiting order is tried
 * and the cheapest is kept. */
import { astar, weightsFor } from './astar.js';
import { routeStats } from './stats.js';

// Every leg of a walk gets its own shade of the route colour (cyan, azure, teal, periwinkle),
// used on the map, the 3D view, the leg list and the elevation chart.
export const LEG_COLORS = ['#62d6e8', '#3f8ff0', '#3fbfae', '#8e9bff'];

/** Path between two cells for priority p, cached in `cache` (a Map).
 *  Costs are symmetric, so a→b reversed = b→a and only one search is needed per pair. */
export function leg(grid, cache, a, b, p) {
  const key = `${p}:${Math.min(a, b)}-${Math.max(a, b)}`;
  if (!cache.has(key)) cache.set(key, a < b ? astar(grid, a, b, weightsFor(p)) : astar(grid, b, a, weightsFor(p)));
  const res = cache.get(key);
  if (!res) return null;
  return { cost: res.cost, path: a < b ? res.path : [...res.path].reverse() };
}

/** All orderings of an array: [1,2] → [[1,2],[2,1]]. */
export function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((q) => [x, ...q]));
}

/** Best visiting order and full path for priority p, or null if a point can't be reached.
 *  cells = grid cell of each point (cells[0] is the start).
 *  bestOrder: try every order of the targets (else visit them as numbered).
 *  returnToStart: end the walk back at the start.
 *  Returns {priority, seq, path, stopAt, legs, stats}:
 *    seq = point numbers in visiting order, path = every cell walked,
 *    stopAt = [{point, pos}] where each stop is along the path. */
export function bestRoute(grid, cells, { priority: p, bestOrder, returnToStart, cache }) {
  const targets = cells.slice(1).map((_, i) => i + 1);
  const orders = bestOrder ? permutations(targets) : [targets];

  let best = null;
  for (const order of orders) {
    const seq = [0, ...order, ...(returnToStart ? [0] : [])];
    let total = 0, ok = true;
    for (let k = 0; k + 1 < seq.length && ok; k++) {
      const l = leg(grid, cache, cells[seq[k]], cells[seq[k + 1]], p);
      if (!l) ok = false; else total += l.cost;
    }
    if (ok && (!best || total < best.total)) best = { seq, total };
  }
  if (!best) return null;

  // Join the legs into one path; remember where each stop is along it
  const path = [cells[0]], stopAt = [];
  for (let k = 1; k < best.seq.length; k++) {
    const l = leg(grid, cache, cells[best.seq[k - 1]], cells[best.seq[k]], p);
    path.push(...l.path.slice(1));
    stopAt.push({ point: best.seq[k], pos: path.length - 1 });
  }
  return { priority: p, seq: best.seq, path, stopAt, legs: routeLegs(stopAt), stats: routeStats(grid, path) };
}

/** Split a route into legs: start → first target → … (→ back to start). Path indices [from, to]. */
export function routeLegs(stopAt) {
  let from = 0;
  return stopAt.map((s, i) => {
    const leg = { i, from, to: s.pos, fromPoint: i === 0 ? 0 : stopAt[i - 1].point, toPoint: s.point, color: LEG_COLORS[i % LEG_COLORS.length] };
    from = s.pos;
    return leg;
  });
}
