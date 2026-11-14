/* Drawing the planned route on the 2D map.
 *
 * A walk out to a target and back often uses the same corridor twice. To keep that readable,
 * every leg gets its own shade of the route colour, arrows show the direction of travel, and each
 * leg is drawn a little to the RIGHT of its direction of travel (like a two-way road), so an
 * out-and-back walk shows as two side-by-side lanes instead of one line drawn over itself.
 */
import { state, REDUCED_MOTION } from './state.js';
import { map, routeLayer, latlngOf } from './map.js';
import { sync3DRoutes } from './view3dBridge.js';

const LANE_PX = 4;            // 2D lane offset, in screen pixels (so it looks the same at every zoom)
const ARROW_EVERY_PX = 90;    // spacing of direction arrows along a leg

/** Shift a run of grid cells `px` screen pixels to the right of the direction of travel. */
function laneLatLngs(cells, px) {
  const pts = cells.map((idx) => map.latLngToLayerPoint(latlngOf(idx)));
  const n = pts.length;
  return pts.map((p, k) => {
    const a = pts[Math.max(0, k - 2)], b = pts[Math.min(n - 1, k + 2)];   // smoothed direction
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    return map.layerPointToLatLng(L.point(p.x - dy / len * px, p.y + dx / len * px));
  });
}

/** Small chevrons along a lane, pointing the way the astronaut walks. */
function addArrows(lls, layer) {
  const pts = lls.map((ll) => map.latLngToLayerPoint(ll));
  const n = pts.length;
  let next = ARROW_EVERY_PX / 2, walked = 0;
  for (let k = 1; k < n; k++) {
    const seg = pts[k - 1].distanceTo(pts[k]);
    while (seg > 0 && walked + seg >= next) {
      const t = (next - walked) / seg;
      const p = pts[k - 1].add(pts[k].subtract(pts[k - 1]).multiplyBy(t));
      const a = pts[Math.max(0, k - 4)], b = pts[Math.min(n - 1, k + 3)];
      const deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      L.marker(map.layerPointToLatLng(p), {
        icon: L.divIcon({ className: 'chev', html: `<i style="transform:rotate(${deg.toFixed(0)}deg)"></i>`, iconSize: [12, 12], iconAnchor: [6, 6] }),
        interactive: false, keyboard: false, zIndexOffset: -1000,
      }).addTo(layer);
      next += ARROW_EVERY_PX;
    }
    walked += seg;
  }
}

let drawToken = 0;

/** Draw the chosen route (as coloured lanes per leg) and the comparison route. Re-run on zoom.
 *  Also stores chosen.lane: where the astronaut walks on screen, per path index (used by playback). */
export function drawRoutes(animate) {
  routeLayer.clearLayers();
  sync3DRoutes();
  if (!state.plan) return;
  const token = ++drawToken;
  const { chosen, ghost } = state.plan;
  if (ghost && ghost.path.join() !== chosen.path.join()) {
    L.polyline(ghost.path.map(latlngOf), { color: '#d9b24c', weight: 3, opacity: 0.9, dashArray: '8 7', interactive: false }).addTo(routeLayer);
  }

  const lane = new Array(chosen.path.length);   // where the astronaut walks on screen, per path index
  const arrows = L.layerGroup();
  let delay = 0;
  for (const leg of chosen.legs) {
    const lls = laneLatLngs(chosen.path.slice(leg.from, leg.to + 1), LANE_PX);
    lls.forEach((ll, j) => { if (j > 0 || leg.i === 0) lane[leg.from + j] = ll; });
    L.polyline(lls, { color: '#14181c', weight: 8, opacity: 0.55, interactive: false }).addTo(routeLayer);
    const line = L.polyline(lls, { color: leg.color, weight: 4, opacity: 1, interactive: false }).addTo(routeLayer);
    addArrows(lls, arrows);

    // Draw-in animation, one leg after the other
    const el = line.getElement();
    if (animate && el && !REDUCED_MOTION) {
      const len = el.getTotalLength();
      const duration = Math.min(900, 250 + len * 0.5);
      el.animate([
        { strokeDasharray: `${len} ${len}`, strokeDashoffset: len },
        { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 },
      ], { duration, delay, easing: 'ease-out', fill: 'backwards' });
      delay += duration;
    }
  }
  chosen.lane = lane;
  // arrows appear once the lines have drawn in
  setTimeout(() => { if (token === drawToken) arrows.addTo(routeLayer); }, animate && !REDUCED_MOTION ? delay : 0);
}
