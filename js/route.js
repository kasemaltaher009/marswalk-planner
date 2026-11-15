/* Re-plan the walk whenever the points or options change.
 * The search itself is in routing/ (A*, best order, stats); this file connects it to the page. */
import { state, $, setStatus, clearError, toast, priority } from './state.js';
import { bestRoute } from './routing/planner.js';
import { drawRoutes } from './routeDraw.js';
import { revealRoute, latlngOf } from './map.js';
import { renderSummary } from './summary.js';
import { play, stopPlayback, placeAstronaut } from './playback.js';
import { refreshPointList } from './points.js';

const legCache = new Map();  // "priority:a-b" → {path, cost} or null (the grid never changes)
let planTimer = null;

/** Best route for priority p through the current points, using the options in the left panel. */
function routeFor(p) {
  return bestRoute(state.grid, state.points.map((pt) => pt.idx), {
    priority: p, bestOrder: $('optOrder').checked, returnToStart: $('optReturn').checked, cache: legCache,
  });
}

/** Re-plan after any change. `animate` draws the route in (not while dragging the slider). */
export function planRoute({ animate = true } = {}) {
  clearTimeout(planTimer);
  stopPlayback(true, false);   // the old route is about to go: don't place the astronaut on it
  clearError();                // an error about the old plan no longer applies
  if (state.notice) toast(state.notice.trim());
  if (state.points.length < 2) {
    state.plan = null;
    if (state.notice) setStatus(state.notice);
    state.notice = '';
    drawRoutes(false);
    renderSummary();
    return;
  }
  setStatus('Planning the route…');
  // let the browser paint the status first; A* takes a moment
  planTimer = setTimeout(() => {
    const p = priority();
    const ghostPriority = p > 50 ? 0 : 100;     // compare with the other end of the slider
    const chosen = routeFor(p);
    const ghost = chosen && routeFor(ghostPriority);
    if (!chosen) {
      state.plan = null;
      setStatus('No safe route: a point is cut off by cliffs or slopes over 25°. Move it.', true);
    } else {
      state.plan = { chosen, ghost, ghostPriority };
      if (renumberByVisit(state.plan)) {
        state.notice += 'Targets renumbered in walking order. ';
        toast('Targets renumbered: target 1 is now the first one you walk to.');
      }
      setStatus(state.notice || 'Route ready.');
    }
    state.notice = '';
    drawRoutes(animate);
    renderSummary();
    // not while dragging the priority slider (animate: false), where the map should hold still
    if (animate && state.plan && state.activeView === 'map') revealRoute(state.plan.chosen.path.map(latlngOf));
    if (state.activeView === 'pov' && state.plan) { play.tl = null; placeAstronaut(); }
  }, 20);
}

/** "Visit targets in the best order" may walk 3 → 1 → 2. Then the targets are renumbered so that
 *  target 1 is the first one walked to: pins, the waypoint list, the leg list, the elevation chart,
 *  the 3D pins and the helmet display ("Walking to target 1") all count the same way.
 *  Returns true if the numbers changed. */
function renumberByVisit(plan) {
  const order = plan.chosen.seq.slice(1).filter((p) => p !== 0);   // targets in walking order
  if (order.every((p, i) => p === i + 1)) return false;
  const newNo = [0];                       // old point number → new one
  order.forEach((p, i) => { newNo[p] = i + 1; });
  state.points = [state.points[0], ...order.map((p) => state.points[p])];
  for (const r of [plan.chosen, plan.ghost]) {
    if (!r) continue;
    r.seq = r.seq.map((p) => newNo[p]);
    r.stopAt.forEach((s) => { s.point = newNo[s.point]; });
    r.legs.forEach((l) => { l.fromPoint = newNo[l.fromPoint]; l.toPoint = newNo[l.toPoint]; });
  }
  refreshPointList();
  return true;
}
