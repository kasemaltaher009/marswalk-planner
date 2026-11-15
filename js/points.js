/* The start + target points the astronaut places on the map. */
import { state, $, setStatus, MAX_TARGETS, SNAP_RADIUS_CELLS, PHOTO_RADIUS_M, pointName } from './state.js';
import { nearestWalkable } from './routing/grid.js';
import { map, latlngOf, cellAtLatLng } from './map.js';
import { nearestStop } from './curiosity.js';
import { photoPopup } from './photos.js';
import { planRoute } from './route.js';
import { sync3DMarkers } from './view3dBridge.js';

/** Clicks on the ground this soon after the side panels slid in or out are ignored: the view and its
 *  buttons just moved, so a click meant for a button (e.g. right after End walk) would otherwise land
 *  on the ground and quietly add a waypoint. */
const SETTLE_MS = 500;

export function addPoint(cellIdx) {
  if (performance.now() - state.layoutMovedAt < SETTLE_MS) return;
  if (state.points.length >= 1 + MAX_TARGETS) {
    setStatus(`That's the maximum of ${MAX_TARGETS} targets. Drag a marker to move it, or undo the last one.`, true);
    return;
  }
  const idx = snapToWalkable(cellIdx);
  if (idx === null) return;
  const marker = L.marker(latlngOf(idx), { draggable: true, autoPan: true });
  const pt = { idx, marker };
  state.points.push(pt);

  marker.on('dragend', () => {
    const newIdx = snapToWalkable(cellAtLatLng(marker.getLatLng()));
    if (newIdx !== null) pt.idx = newIdx;
    marker.setLatLng(latlngOf(pt.idx));
    refreshPointList();
    planRoute();
  });
  marker.bindPopup(() => pointPopup(pt), { maxWidth: 300 });
  marker.addTo(map);
  refreshPointList();
  planRoute();
}

/** Clicked a cliff? Move to the nearest walkable cell (within 100 m). */
function snapToWalkable(idx) {
  if (idx < 0) { setStatus('Click inside the planning area (the photo).', true); return null; }
  const snapped = nearestWalkable(state.grid, idx, SNAP_RADIUS_CELLS);
  if (snapped === null) {
    setStatus('Too steep there and no walkable ground within 100 m. Pick another spot.', true);
  } else if (snapped !== idx) {
    state.notice = 'That spot was too steep, so the point moved to the nearest walkable ground. ';
  }
  return snapped;
}

function pointPopup(pt) {
  const { grid } = state;
  const i = state.points.indexOf(pt);
  const info = `<p>Elevation ${grid.elev[pt.idx].toFixed(0)} m, local slope ${grid.slope[pt.idx].toFixed(0)}°</p>`;
  const near = nearestStop(latlngOf(pt.idx));
  let el;
  if (near) {
    el = photoPopup(near.p.sol, null, pointName(i),
      `${info}<p>Curiosity stopped ${Math.round(near.d)} m from here on sol ${near.p.sol}. This is what it saw.</p>`);
  } else {
    el = document.createElement('div');
    el.className = 'wp-popup';
    el.innerHTML = `<h4>${pointName(i)}</h4>${info}<p>Curiosity never stopped within ${PHOTO_RADIUS_M} m of this spot, so there's no photo of it.</p>`;
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `Remove ${pointName(i).toLowerCase()}`;
  btn.addEventListener('click', () => removePoint(pt));
  el.append(btn);
  return el;
}

export function removePoint(pt) {
  map.removeLayer(pt.marker);
  state.points = state.points.filter((p) => p !== pt);
  refreshPointList();
  planRoute();
}

export function clearPoints() {
  state.points.forEach((p) => map.removeLayer(p.marker));
  state.points = [];
  refreshPointList();
  planRoute();
}

export function refreshPointList() {
  const { points, grid } = state;
  points.forEach((pt, i) => {
    pt.marker.setIcon(L.divIcon({
      className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      html: `<div class="pin ${i === 0 ? 'start' : 'target'}">${i === 0 ? 'S' : i}</div>`,
    }));
  });
  $('pointList').innerHTML = points.map((pt, i) =>
    `<li title="Elevation ${grid.elev[pt.idx].toFixed(0)} m"><span class="tag ${i === 0 ? 'start' : 'target'}">${i === 0 ? 'S' : i}</span>
      ${pointName(i)}
      <button type="button" class="rm" data-i="${i}" aria-label="Remove ${pointName(i).toLowerCase()}" title="Remove">×</button></li>`).join('');
  $('wpbar').dataset.count = points.length;   // CSS shows the list and route options once there are points
  refreshHint();
  $('btnUndo').disabled = $('btnClear').disabled = points.length === 0;
  sync3DMarkers();
}

/** The "what to do next" line above the waypoint list. */
export function refreshHint() {
  const n = state.points.length;
  const onGlobe = state.activeView !== 'map' && document.querySelector('.stage').dataset.globe === 'true';
  $('clickHint').textContent = onGlobe && n === 0
    ? 'First click Gale Crater on the globe to fly down to the walking area.'
    : state.activeView === 'pov'
      ? 'Undo, × or Clear all edit the points here. Switch to Map or 3D terrain to place new ones.'
    : n === 0
      ? "Click the ground to place your start. The end of Curiosity's track is a good spot."
      : n <= MAX_TARGETS
        ? `Click to add science target ${n}, or drag a marker to move it.`
        : 'All targets placed. Drag a marker to move it.';
}
