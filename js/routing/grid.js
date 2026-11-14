/* The cost grid: a W × H raster of 5 m cells over the planning area.
 * Row 0 = north edge, column 0 = west edge; cell index = r * W + c.
 * Pure functions only (no map, no page), so they run in Node for the tests too.
 */

export const BLOCKED = 255;   // cost 255 = too steep / cliff, can't walk there

const NO_ELEV = 65535;   // "no data" in cost_grid.bin's elevation part

/** cost_grid.json (header) + the unzipped bytes of cost_grid.bin.gz → {width, height, cell_m,
 *  cost, elev_dm}, ready for buildGrid. The bytes are W·H cost bytes, then W·H uint16
 *  little-endian elevations in decimetres above header.elev_base_dm (65535 = no data → -99999,
 *  as buildGrid expects), each stored as the change from the cell to its left (mod 65536). */
export function decodeGrid(header, buffer) {
  const W = header.width, n = W * header.height;
  if (buffer.byteLength !== n * 3) throw new Error(`cost grid has ${buffer.byteLength} bytes, expected ${n * 3}`);
  const cost = new Uint8Array(buffer, 0, n);
  const view = new DataView(buffer, n);
  const elev_dm = new Int32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = ((i % W === 0 ? 0 : v) + view.getUint16(i * 2, true)) & 0xffff;   // undo the left-neighbour change
    elev_dm[i] = v === NO_ELEV ? -99999 : header.elev_base_dm + v;
  }
  return { ...header, cost, elev_dm };
}

/** Turn the cost grid (decodeGrid's result, or plain arrays) into typed arrays, and work out the slope of every cell.
 *  `bounds` = {north, south, west, east} of the area (from config.json). */
export function buildGrid(cg, bounds) {
  const W = cg.width, H = cg.height, cell = cg.cell_m;
  const cost = Uint8Array.from(cg.cost);
  const elev = Float32Array.from(cg.elev_dm, (v) => (v <= -99999 ? NaN : v / 10));

  // slope (degrees) from neighbouring elevations, like numpy.gradient
  const slope = new Float32Array(W * H);
  const e = (r, c) => elev[Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const dx = (e(r, c + 1) - e(r, c - 1)) / ((Math.min(W - 1, c + 1) - Math.max(0, c - 1)) * cell);
      const dy = (e(r + 1, c) - e(r - 1, c)) / ((Math.min(H - 1, r + 1) - Math.max(0, r - 1)) * cell);
      slope[r * W + c] = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI;
    }
  }
  let blocked = 0;
  for (const v of cost) if (v === BLOCKED) blocked++;
  return { W, H, cell, b: bounds, cost, elev, slope, blockedPct: 100 * blocked / (W * H) };
}

/** Cell index → [row, col]. */
export const rcOf = (grid, idx) => [Math.floor(idx / grid.W), idx % grid.W];

// grid cell ↔ lat/lon. The grid is equirectangular, so the mapping is linear.

/** Cell index under a lat/lon, or -1 if it's outside the area. */
export function cellAt(grid, lat, lng) {
  const { W, H, b } = grid;
  const c = Math.floor((lng - b.west) / (b.east - b.west) * W);
  const r = Math.floor((b.north - lat) / (b.north - b.south) * H);
  return (r < 0 || r >= H || c < 0 || c >= W) ? -1 : r * W + c;
}

/** [lat, lng] of the centre of cell (r, c). r and c may be fractional:
 *  used to place the astronaut between two cells. */
export function centreOfRC(grid, r, c) {
  const { W, H, b } = grid;
  return [b.north - (r + 0.5) / H * (b.north - b.south),
          b.west + (c + 0.5) / W * (b.east - b.west)];
}

/** The nearest walkable cell to `idx`, searching rings up to `radius` cells out.
 *  Returns idx itself if it's walkable, or null if there's nothing walkable nearby. */
export function nearestWalkable(grid, idx, radius) {
  const { W, H, cost } = grid;
  if (cost[idx] !== BLOCKED) return idx;
  const [r0, c0] = rcOf(grid, idx);
  for (let rad = 1; rad <= radius; rad++) {
    let best = null, bestD = Infinity;
    for (let r = r0 - rad; r <= r0 + rad; r++) {
      for (let c = c0 - rad; c <= c0 + rad; c++) {
        if (r < 0 || r >= H || c < 0 || c >= W) continue;
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad) continue;  // ring only
        const d = (r - r0) ** 2 + (c - c0) ** 2;
        if (cost[r * W + c] !== BLOCKED && d < bestD) { best = r * W + c; bestD = d; }
      }
    }
    if (best !== null) return best;
  }
  return null;
}
