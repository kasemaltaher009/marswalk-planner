/* Numbers for a walked path: distance, climb, steepest grade, walking time, rough ground. */

export const FLAT_SPEED_KMH = 3.0;   // suited astronaut on flat, firm ground
export const ROUGH_COST = 25;        // cost of a 10° slope: anything above counts as rough ground

/** Walk the path (cell indices) step by step and add everything up.
 *  dist[k] and walkH[k] are cumulative (metres, hours) up to path index k;
 *  grade(k) is the slope along the path around k (rise / run). */
export function routeStats(grid, path) {
  const { W, cell, elev, cost } = grid;
  const n = path.length;
  const dist = new Float64Array(n);     // cumulative horizontal distance (m)
  const walkH = new Float64Array(n);    // cumulative walking time (hours)
  for (let k = 1; k < n; k++) {
    const a = path[k - 1], b = path[k];
    const diag = Math.floor(a / W) !== Math.floor(b / W) && a % W !== b % W;
    dist[k] = dist[k - 1] + (diag ? Math.SQRT2 : 1) * cell;
  }
  // Grade along the path over a ~20 m window (single 5 m steps are noisy)
  const grade = (k) => {
    const a = Math.max(0, k - 2), b = Math.min(n - 1, k + 2);
    const run = dist[b] - dist[a];
    return run > 0 ? (elev[path[b]] - elev[path[a]]) / run : 0;
  };

  let up = 0, down = 0, maxGradeDeg = 0, rough = 0;
  for (let k = 1; k < n; k++) {
    const dz = elev[path[k]] - elev[path[k - 1]];
    if (dz > 0) up += dz; else down -= dz;
    const g = grade(k);
    maxGradeDeg = Math.max(maxGradeDeg, Math.abs(Math.atan(g)) * 180 / Math.PI);
    const step = dist[k] - dist[k - 1];
    const c = (cost[path[k]] + cost[path[k - 1]]) / 2;
    if (c > ROUGH_COST) rough += step;
    // Tobler's hiking function (shape of speed vs grade), scaled to a suited astronaut,
    // then slowed down on harder ground (sand, side-slopes): cost 50 ≈ 2/3 speed.
    const tobler = Math.exp(-3.5 * Math.abs(g + 0.05)) / Math.exp(-3.5 * 0.05);
    const speedKmh = FLAT_SPEED_KMH * tobler / (1 + (c - 1) / 100);
    walkH[k] = walkH[k - 1] + step / 1000 / speedKmh;
  }
  return {
    dist, walkH, grade, total: dist[n - 1], up, down, maxGradeDeg,
    walkHours: walkH[n - 1], roughPct: 100 * rough / (dist[n - 1] || 1),
  };
}
