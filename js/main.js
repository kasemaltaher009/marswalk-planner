/* Ariadne (Marswalk planner) — plans the safest walking route on Mount Sharp.
 * Code written with help from Claude (Anthropic), an AI coding assistant; reviewed and tested by the team.
 *
 * Flow: load web/data/* → map + layers → user places start + targets
 *       → A* on cost_grid.json for every pair of points → best visiting order
 *       → go/no-go poll, stats (the other end of the priority slider is drawn dashed on the map)
 *       → optional playback (astronaut walks the route with a helmet display) and 3D view.
 *
 * Where things live (all in web/js/):
 *   routing/     the search: grid, A*, best order, walk stats (no page code, unit-tested in web/tests/)
 *   state.js     shared state, settings, assumptions, formatting
 *   data.js      loading web/data/*
 *   map.js       Leaflet map and layers        points.js    start + target points
 *   route.js     re-planning on every change   routeDraw.js route lanes and arrows on the map
 *   summary.js   go/no-go poll + numbers       charts.js    elevation + temperature charts
 *   weather.js   REMS weather                  playback.js  the walk playback and helmet display
 *   photos.js    Curiosity + orbital photos    curiosity.js Curiosity's stops on the map
 *   view3dBridge.js  map / 3D / astronaut view switch, and keeping the 3D view in step
 *   main.js      (this file) start-up and the buttons
 */
import { state, $, setStatus, toast, fieldNumber, PLAY_SECONDS_PER_HOUR, REDUCED_MOTION, priority, playSpeed } from './state.js';
import { loadAll } from './data.js';
import { buildGrid } from './routing/grid.js';
import { setupMap } from './map.js';
import { latestStop } from './curiosity.js';
import { refreshPointList, removePoint, clearPoints, undoPoint } from './points.js';
import { planRoute } from './route.js';
import { renderSummary, setupSummaryFit } from './summary.js';
import { setupWeather, renderWeather } from './weather.js';
import { play, startPlayback, stopPlayback, setPanels, scrubTo, skipWork } from './playback.js';
import { showView, switchView, zoomOutToMars } from './view3dBridge.js';
import { setupTour, maybeStartTour } from './tour.js';

async function init() {
  setupBriefing();
  const mb = (b) => (b / 1e6).toFixed(1);
  const showProgress = ({ loaded, total }) => {
    const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
    $('loadFill').style.width = `${pct}%`;
    $('loadText').textContent = total ? `Downloading Mars data… ${mb(loaded)} of ${mb(total)} MB (${pct}%)` : 'Downloading Mars data…';
  };
  try {
    const { config, costGrid, weather, curiosity } = await loadAll(showProgress);
    state.config = config;
    state.grid = buildGrid(costGrid, config.bounds);
    state.weather = weather || [];
    state.curiosity = curiosity;
  } catch (err) {
    setStatus(err.message, true);
    $('loadText').textContent = err.message;
    $('loadText').classList.add('error');
    $('btnBrief').textContent = 'Could not load';
    return;
  }
  $('briefLoad').hidden = true;
  $('btnBrief').disabled = false;
  $('btnBrief').textContent = 'Start planning';
  if (!returning) $('btnBrief').focus();
  const { grid, config } = state;
  setupMap();
  setupControls();
  setupWeather();
  setupTour();
  setupSummaryFit();
  refreshPointList();
  // small views: the verdict card starts folded to one line, so it doesn't cover the waypoints
  if (document.querySelector('.stage').clientWidth <= 760) $('summary').open = false;
  $('bBlocked').textContent = `${grid.blockedPct.toFixed(0)}%`;
  if (state.curiosity) $('bLastSol').textContent = latestStop().properties.sol;
  $('bSize').textContent = `${config.size_m / 1000} × ${config.size_m / 1000} km`;
  setStatus(`Ready. ${grid.blockedPct.toFixed(0)}% of the area is too steep to walk.`);
  // start on a clean Mars globe: no panels, hint card, top buttons or view switch (body.globe-intro);
  // they all come in once you land on the map (showView in view3dBridge.js)
  setPanels(false, { animate: false });
  document.body.classList.add('globe-intro');
  showView('3d');   // start on the Mars globe (the 3D view opens there); click Gale Crater to fly down
  if (returning) closeBriefing();
}

// The mission briefing is shown in full on the first visit only (remembered in this browser).
// Later visits get just its title and loading bar, which close by themselves once the data is in.
const BRIEFING_KEY = 'marswalk.briefingSeen';
let returning = false;
try { returning = localStorage.getItem(BRIEFING_KEY) === '1'; } catch { /* private window: full briefing */ }

/** While the briefing is open, everything behind it is inert: no Tab or clicks reach it. */
function setPageInert(on) {
  for (const el of document.body.children) if (el !== $('briefing') && el.tagName !== 'SCRIPT') el.inert = on;
}

function setupBriefing() {
  $('briefing').classList.toggle('returning', returning);
  setPageInert(true);
  $('btnBrief').addEventListener('click', () => {
    try { localStorage.setItem(BRIEFING_KEY, '1'); } catch { /* fine */ }
    closeBriefing();
  });
}

function closeBriefing() {
  const b = $('briefing');
  setPageInert(false);
  if (REDUCED_MOTION) { b.hidden = true; maybeStartTour(); return; }
  b.classList.add('leaving');
  setTimeout(() => { b.hidden = true; maybeStartTour(); }, 350);   // first visit: the guided tour
}

// ---------------------------------------------------------------------------
// Buttons & inputs
// ---------------------------------------------------------------------------
function setupControls() {
  // the × on each waypoint row removes that point
  $('pointList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    removePoint(state.points[i]);
    const next = $('pointList').querySelectorAll('button[data-i]');
    (next[Math.min(i, next.length - 1)] || $('btnUndo')).focus();   // keep keyboard focus in the list
  });
  $('btnUndo').addEventListener('click', undoPoint);
  $('btnClear').addEventListener('click', () => {
    clearPoints();
    setStatus('Cleared. Click the ground to place a new start, or press Undo to bring the points back.');
  });
  // These change which route is best → re-plan
  ['optReturn', 'optOrder'].forEach((id) => $(id).addEventListener('change', () => planRoute()));

  // Route priority slider: re-plan live while dragging (no draw-in animation)
  const describe = () => {
    const p = priority();
    $('priorityText').textContent = p === 100 ? 'Stays on gentle, firm ground, even if longer.'
      : p === 0 ? 'Quickest walk that avoids cliffs, even over steep or sandy ground.'
      : `${p}% safety: a balance of speed and gentle ground.`;
  };
  $('priority').addEventListener('input', () => { describe(); planRoute({ animate: false }); });

  // These only change the numbers → refresh the summary (and the playback timeline)
  ['inStart', 'inStop', 'inSuit'].forEach((id) => $(id).addEventListener('input', () => { stopPlayback(true); renderSummary(); }));
  // Leaving a number field: show the value the planner really uses (kept inside the field's range)
  [['inStop', 0, 'Work at each target', 'min'], ['inSuit', 4, 'Suit limit', 'h']].forEach(([id, fallback, name, unit]) =>
    $(id).addEventListener('change', () => {
      const used = fieldNumber(id, fallback);
      if ($(id).valueAsNumber === used) return;
      $(id).value = used;
      toast(`${name} must be ${$(id).min} to ${$(id).max} ${unit}, so it is set to ${used} ${unit}.`, true);
    }));
  $('inSol').addEventListener('change', () => { renderWeather(); renderSummary(); });

  // Playback
  $('btnPlay').addEventListener('click', () => {
    if (play.playing) { stopPlayback(); return; }
    startPlayback();
  });
  $('btnEnd').addEventListener('click', () => stopPlayback(true));
  $('btnSkipWork').addEventListener('click', skipWork);
  // Narrow views: the helmet display is a slim bar until opened (the arrow, or a tap on the photo)
  const hudOpen = (open) => {
    $('hud').classList.toggle('open', open);
    $('btnHudMore').setAttribute('aria-expanded', open);
    $('btnHudMore').setAttribute('aria-label', open ? 'Hide walk details' : 'Show walk details');
  };
  new ResizeObserver(() => document.querySelector('.stage').style.setProperty('--hud-h', `${$('hud').offsetHeight}px`)).observe($('hud'));
  $('btnHudMore').addEventListener('click', () => hudOpen(!$('hud').classList.contains('open')));
  $('hPhoto').addEventListener('click', (e) => {
    if (getComputedStyle($('btnHudMore')).display === 'none' || $('hud').classList.contains('open')) return;
    e.preventDefault();   // in the slim bar the thumbnail opens the details, not the full-size photo
    hudOpen(true);
  }, true);
  $('btnPanels').addEventListener('click', () => setPanels(document.body.classList.contains('panels-hidden')));
  // panels hidden, the verdict is a compact line: clicking it brings the panels (and the full card) back
  $('verdictBox').addEventListener('click', (e) => {
    if (!document.body.classList.contains('panels-hidden')) return;
    e.preventDefault();
    setPanels(true);
  });
  const showSpeed = () => {
    const s = playSpeed();
    $('speedOut').textContent = `${s}×`;
    $('speed').setAttribute('aria-valuetext', `${s} times, one hour outside in ${Math.round(PLAY_SECONDS_PER_HOUR / s)} seconds`);
  };
  $('speed').addEventListener('input', showSpeed);   // takes effect immediately, even mid-walk
  showSpeed();
  $('scrub').addEventListener('input', () => scrubTo(Number($('scrub').value)));

  $('btnMap').addEventListener('click', () => switchView('map'));   // glides and crossfades with the 3D view
  $('btnMars').addEventListener('click', zoomOutToMars);            // map → up and out to the globe
  $('btn3D').addEventListener('click', () => switchView('3d'));
  $('btnPOV').addEventListener('click', () => switchView('pov'));
}

init();
