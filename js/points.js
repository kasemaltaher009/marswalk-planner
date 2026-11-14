/* The start + target points the astronaut places on the map. */
import { state, $, setStatus, MAX_TARGETS, SNAP_RADIUS_CELLS, PHOTO_RADIUS_M, pointName } from './state.js';
import { nearestWalkable } from './routing/grid.js';
import { map, latlngOf, cellAtLatLng } from './map.js';
import { nearestStop } from './curiosity.js';
import { photoPopup } from './photos.js';
import { planRoute } from './route.js';
import { sync3DMarkers } from './view3dBridge.js';

export function addPoint(cellIdx) {
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
  if (idx < 0) { setStatus('Click inside the dashed gold square, the planning area.', true); return null; }
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
    `<li><span class="tag ${i === 0 ? 'start' : 'target'}">${i === 0 ? 'S' : i}</span>
      ${pointName(i)}<span class="sub">${grid.elev[pt.idx].toFixed(0)} m</span></li>`).join('');
  $('clickHint').textContent = points.length === 0
    ? 'Click the map to place your start, the airlock or rover.'
    : points.length <= MAX_TARGETS
      ? `Click to add science target ${points.length}. Drag markers to adjust them, or click one to see Curiosity's photo from there.`
      : 'All three targets are placed. Drag markers to adjust them, or click one to see its photo.';
  $('btnUndo').disabled = $('btnClear').disabled = points.length === 0;
  sync3DMarkers();
}
