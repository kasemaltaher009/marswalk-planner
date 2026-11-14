/* Re-plan the walk whenever the points or options change.
 * The search itself is in routing/ (A*, best order, stats); this file connects it to the page. */
import { state, $, setStatus, priority } from './state.js';
import { bestRoute } from './routing/planner.js';
import { drawRoutes } from './routeDraw.js';
import { renderSummary } from './summary.js';
import { play, stopPlayback, placeAstronaut } from './playback.js';

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
    const t0 = performance.now();
    const p = priority();
    const ghostPriority = p > 50 ? 0 : 100;     // compare with the other end of the slider
    const chosen = routeFor(p);
    const ghost = chosen && routeFor(ghostPriority);
    if (!chosen) {
      state.plan = null;
      setStatus('No safe route: a point is cut off by cliffs or slopes over 25°. Move it.', true);
    } else {
      state.plan = { chosen, ghost, ghostPriority };
      setStatus(`${state.notice}Route planned in ${Math.round(performance.now() - t0)} ms.`);
    }
    state.notice = '';
    drawRoutes(animate);
    renderSummary();
    if (state.activeView === 'pov' && state.plan) { play.tl = null; placeAstronaut(); }
  }, 20);
}
