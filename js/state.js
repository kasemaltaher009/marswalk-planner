/* Shared app state, settings and small page helpers used by every module.
 *
 * The state lives in one object so any module can read and change it
 * (ES modules can't reassign each other's variables, but they can change an object's fields).
 */

export const DATA = 'data/';

// ---------------------------------------------------------------------------
// Assumptions (say these in the pitch). Walking speed and "rough ground" live in routing/stats.js.
// ---------------------------------------------------------------------------
export const DAY_START_H = 8, DAY_END_H = 17;   // comfortable daylight window (local solar time)
export const RESERVE_H = 0.5;        // suit time we want left when back inside
export const COLD_LIMIT_C = -60;     // below this air temperature, flag the thermal system
export const MAX_TARGETS = 3;
export const SNAP_RADIUS_CELLS = 20; // a click on a blocked cell moves to walkable ground within 100 m
export const PHOTO_RADIUS_M = 400;   // show Curiosity's photos if one of its stops is this close
export const PLAY_SECONDS_PER_HOUR = 10;   // playback: one hour outside takes 10 s at 1×
// Speed slider steps (multipliers of 1×). 0.1× = one hour outside in 100 s, for slow astronaut-view walks.
export const PLAY_SPEEDS = [0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 5];

export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
export const state = {
  config: null,      // config.json
  grid: null,        // cost grid (see routing/grid.js)
  weather: [],       // weather.json
  curiosity: null,   // curiosity.geojson
  points: [],        // [{idx, marker}] — points[0] is the start
  plan: null,        // {chosen, ghost, ghostPriority} — routes for the current points
  notice: '',        // one-off message (e.g. "point was moved") shown with the next status
  activeView: 'map', // 'map', '3d' or 'pov'
  view3d: null,      // the 3D view, once view3d.js has loaded
};

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
export const $ = (id) => document.getElementById(id);
export const setStatus = (msg, isError = false) => {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
};

// ---------------------------------------------------------------------------
// Settings read from the left panel
// ---------------------------------------------------------------------------
export const priority = () => Number($('priority').value);   // 0 = fastest … 100 = safest
export const playSpeed = () => PLAY_SPEEDS[Number($('speed').value)];
export const startHour = () => {
  const [hh, mm] = ($('inStart').value || '10:00').split(':').map(Number);
  return hh + mm / 60;
};
export const stopHours = () => (Number($('inStop').value) || 0) / 60;
export const suitHours = () => Number($('inSuit').value) || 4;
export const selectedWeather = () => state.weather.find((w) => String(w.sol) === $('inSol').value);
/** Walking time plus the work time at every target. */
export const totalHours = (route) => route.stats.walkHours + (state.points.length - 1) * stopHours();

// ---------------------------------------------------------------------------
// Text formatting
// ---------------------------------------------------------------------------
export const fmtH = (h) => {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
export const fmtClock = (h) => {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const priorityName = (p) => (p === 100 ? 'Safest' : p === 0 ? 'Fastest' : `${p}% safety`);
export const pointName = (i) => (i === 0 ? 'Start' : `Target ${i}`);
