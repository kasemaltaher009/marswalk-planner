/* Playback: the astronaut walks the route, with a helmet display (HUD) and a picture of the area. */
import {
  state, $, RESERVE_H, PLAY_SECONDS_PER_HOUR, PHOTO_RADIUS_M,
  playSpeed, startHour, stopHours, suitHours, selectedWeather, fmtH, fmtClock, fmtDist,
} from './state.js';
import { rcOf } from './routing/grid.js';
import { map, astroMarker, walkedLine, latlngOf, latlngOfRC, cellAtLatLng } from './map.js';
import { elevChart, tempChart } from './charts.js';
import { airTempAt } from './weather.js';
import { nearestStop } from './curiosity.js';
import { curiosityPhotos, photoViewer, orbitalCrop, ORBITAL_VIEW_M, photoFacing, turnTo, compassText } from './photos.js';
import { setPhotoPin } from './view3dBridge.js';

// t = hours since stepping out; tl = timeline of the route being played (see buildTimeline)
// look = which way the astronaut view faces; facing = the "photo of where you look" being shown
export const play = { t: 0, playing: false, last: 0, tl: null, lastChart: 0, photoFor: null, photoJob: 0, look: null, facing: null };

/** When the astronaut reaches and leaves every point of the path (hours from stepping out).
 *  stopH = hours of work at each target. */
export function buildTimeline(route, stopH) {
  const { path, stopAt, stats } = route;
  const n = path.length;
  const stopPoint = new Array(n).fill(null);
  stopAt.forEach((s) => { if (s.point !== 0) stopPoint[s.pos] = s.point; });
  const arrive = new Float64Array(n), depart = new Float64Array(n);
  let extra = 0;
  for (let k = 0; k < n; k++) {
    arrive[k] = stats.walkH[k] + extra;
    if (stopPoint[k] !== null) extra += stopH;
    depart[k] = stats.walkH[k] + extra;
  }
  return { route, arrive, depart, stopPoint, total: depart[n - 1] };
}

/** Where the astronaut is at time t: path index k, fraction f towards k+1, and the stop (if working). */
export function stateAt(tl, t) {
  const { arrive, depart, stopPoint } = tl;
  let lo = 0, hi = arrive.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arrive[mid] <= t) lo = mid; else hi = mid - 1; }
  const k = lo;
  if (t < depart[k] || k === arrive.length - 1) return { k, f: 0, stop: stopPoint[k] };
  return { k, f: Math.min(1, (t - depart[k]) / ((arrive[k + 1] - depart[k]) || 1)), stop: null };
}

/** Make sure there's a timeline for the current plan. */
const ensureTimeline = () => { if (!play.tl) play.tl = buildTimeline(state.plan.chosen, stopHours()); };

export function startPlayback() {
  if (!state.plan) return;
  ensureTimeline();
  if (play.t >= play.tl.total) play.t = 0;
  play.playing = true;
  play.last = performance.now();
  setPlayButton(true);
  $('hud').hidden = false;
  setWalkMode(true);
  requestAnimationFrame(tick);
}

/** During a walk the side panels hide, so the view fills the screen; the helmet display in the
 *  corner keeps the numbers that matter. "End walk" (or any change to the plan) brings them back.
 *  The "Hide panels" button shows or hides them (side panels and top bar) at any time. */
function setWalkMode(on) {
  $('btnEnd').hidden = !on;
  setPanels(!on);
}

export function setPanels(show) {
  if (document.body.classList.contains('panels-hidden') === !show) return;
  document.body.classList.toggle('panels-hidden', !show);
  $('btnPanels').setAttribute('aria-expanded', show);
  $('btnPanelsLabel').textContent = show ? 'Hide panels' : 'Show panels';
  map?.invalidateSize();          // the 3D view notices the new size by itself
}

/** Pause (and show a picture of where the astronaut stopped).
 *  With reset = true, go back to the start because the route or settings changed;
 *  in the astronaut view the astronaut is put back at the start unless `replace` is false
 *  (planRoute does that itself once the new route exists). */
export function stopPlayback(reset = false, replace = true) {
  const wasPlaying = play.playing;
  play.playing = false;
  setPlayButton(false);
  if (!reset) {
    if (wasPlaying && play.tl) renderPlayback();
    return;
  }
  play.t = 0; play.tl = null; play.photoFor = null; play.photoJob++; play.facing = null;
  setWalkMode(false);
  $('hud').hidden = true;
  $('hPhoto').hidden = true;
  setPhotoPin(null);
  $('scrub').value = 0;
  if (map) { map.removeLayer(astroMarker); map.removeLayer(walkedLine); }
  if (elevChart) { elevChart.$cursor = null; elevChart.update('none'); }
  if (tempChart) { tempChart.$cursor = null; tempChart.update('none'); }
  state.view3d?.setAstronaut(null);
  if (replace && state.activeView === 'pov' && state.plan) placeAstronaut();
}

/** Show the astronaut (and helmet display) at the current playback time, e.g. at the start. */
export function placeAstronaut() {
  if (!state.plan) return;
  ensureTimeline();
  $('hud').hidden = false;
  renderPlayback();
}

/** Jump to a point of the walk (the progress slider, 0–1000). */
export function scrubTo(value) {
  if (!state.plan) return;
  ensureTimeline();
  play.t = play.tl.total * value / 1000;
  $('hud').hidden = false;
  renderPlayback();
  setPlayButton(play.playing);
}

function setPlayButton(playing) {
  $('playLabel').textContent = playing ? 'Pause' : (play.t > 0 && play.tl && play.t < play.tl.total ? 'Resume' : 'Play walk');
  $('playIcon').setAttribute('d', playing ? 'M4 2.5h3v11H4zM9 2.5h3v11H9z' : 'M4 2.5v11l9-5.5z');
}

function tick(now) {
  if (!play.playing) return;
  const dt = (now - play.last) / 1000;
  play.last = now;
  play.t = Math.min(play.tl.total, play.t + dt / PLAY_SECONDS_PER_HOUR * playSpeed());
  if (play.t >= play.tl.total) play.playing = false;   // finished: render once more as stopped
  renderPlayback();
  if (!play.playing) { setPlayButton(false); return; }
  requestAnimationFrame(tick);
}

export function renderPlayback() {
  const { grid, config } = state;
  const tl = play.tl;
  const { route } = tl;
  const { path, stats } = route;
  const { k, f, stop } = stateAt(tl, play.t);
  const k1 = Math.min(k + 1, path.length - 1);
  const [r0, c0] = rcOf(grid, path[k]), [r1, c1] = rcOf(grid, path[k1]);
  const r = r0 + (r1 - r0) * f, c = c0 + (c1 - c0) * f;
  // on the 2D map the astronaut walks in its leg's lane (see drawRoutes)
  const lane = route.lane;
  const ll = lane
    ? L.latLng(lane[k].lat + (lane[k1].lat - lane[k].lat) * f, lane[k].lng + (lane[k1].lng - lane[k].lng) * f)
    : latlngOfRC(r, c);
  const walked = stats.dist[k] + (stats.dist[k1] - stats.dist[k]) * f;
  const elev = grid.elev[path[k]] + (grid.elev[path[k1]] - grid.elev[path[k]]) * f;
  const clock = startHour() + play.t;
  const suit = suitHours(), left = suit - play.t;
  const done = play.t >= tl.total;
  const view3d = state.view3d;

  // map
  astroMarker.setLatLng(ll).addTo(map);
  walkedLine.setLatLngs([...(lane ? lane.slice(0, k + 1) : path.slice(0, k + 1).map(latlngOf)), ll]).addTo(map);
  if ($('follow').checked && state.activeView === 'map' && !map.getBounds().pad(-0.2).contains(ll)) map.panTo(ll);
  // 3D / astronaut view: look ~60 m ahead along the route (near the end, keep the last direction)
  const ahead = Math.min(k + 12, path.length - 1);
  let [lr, lc] = rcOf(grid, path[ahead]);
  if (ahead - k < 4) {
    const [br, bc] = rcOf(grid, path[Math.max(0, k - 12)]);
    lr = r + (r - br); lc = c + (c - bc);
  }
  view3d?.setAstronaut(r, c, $('follow').checked, lr, lc);
  // the astronaut view shows only the leg being walked (at a target: the next one)
  const legNow = route.legs.findIndex((l) => l.to > k);
  view3d?.setActiveLeg(legNow < 0 ? route.legs.length - 1 : legNow);

  // helmet display
  const next = route.stopAt.find((s) => s.pos > k);
  $('hClock').textContent = fmtClock(clock);
  $('hStatus').textContent = done ? 'Back at the start. Walk complete.'
    : stop !== null ? `Working at target ${stop}`
    : next && next.point !== 0 ? `Walking to target ${next.point}` : 'Walking back to the start';
  const pct = Math.max(0, Math.min(100, 100 * left / suit));
  $('hSuitBar').style.width = `${pct}%`;
  $('hSuitBar').className = left < 0 ? 'nogo' : left < RESERVE_H + 0.25 ? 'caution' : '';
  $('hSuit').textContent = left >= 0 ? `${fmtH(left)} of suit time left` : `${fmtH(-left)} over the suit limit`;
  $('hDist').textContent = fmtDist(walked);
  $('hElev').textContent = `${elev.toFixed(0)} m`;
  const g = Math.atan(stats.grade(Math.max(1, k))) * 180 / Math.PI;
  $('hGrade').textContent = stop !== null || done ? '0°' : `${g >= 0 ? '+' : ''}${g.toFixed(0)}°`;
  const wx = selectedWeather();
  $('hAir').textContent = wx ? `${airTempAt(wx, clock).toFixed(0)} °C` : 'no data';
  $('hDose').textContent = `${(config.radiation_mSv_per_day * play.t / config.sol_hours).toFixed(3)} mSv`;
  $('hElapsed').textContent = fmtH(play.t);
  // Picture of the area: while working at a target, or whenever playback is stopped
  const spot = stop !== null ? `t${stop}` : !play.playing ? `p${path[k]}` : null;
  showAreaPicture(spot && `${spot}:${state.activeView === 'pov' ? 'look' : 'all'}`, r, c);

  // progress bar + chart cursors (charts at ~10 fps)
  $('scrub').value = Math.round(1000 * play.t / tl.total);
  const now = performance.now();
  if (now - play.lastChart > 100 || !play.playing) {
    play.lastChart = now;
    elevChart.$cursor = walked / 1000; elevChart.update('none');
    if (tempChart) { tempChart.$cursor = clock; tempChart.update('none'); }
  }
}

/** Picture of where the astronaut is: Curiosity's nearest ground photo (if it stopped within
 *  PHOTO_RADIUS_M), or else the orbital close-up of the spot.
 *  `key` identifies the spot (null = walking, hide the picture). */
function showAreaPicture(key, r, c) {
  if (key === play.photoFor) return;
  play.photoFor = key;
  const box = $('hPhoto');
  const job = ++play.photoJob;
  play.facing = null;
  setPhotoPin(null);
  if (key === null) { box.hidden = true; return; }
  const near = nearestStop(latlngOfRC(r, c));
  Promise.all([
    orbitalCrop(r, c).catch(() => null),
    near ? curiosityPhotos(near.p.sol).catch(() => []) : [],
  ]).then(([crop, photos]) => {
    if (job !== play.photoJob) return;          // the astronaut moved on meanwhile
    box.innerHTML = '';
    let caption;
    // astronaut view: the photo Curiosity took from its stop in the direction you're looking
    if (key.endsWith(':look') && photos.some((ph) => ph.look && ph.site === near.p.site && ph.drive === near.p.drive)) {
      box.innerHTML = `<div class="viewer"><a target="_blank" rel="noopener" title="Open full size"><img alt=""></a>` +
        `<p class="facing-none" hidden></p><span class="count"></span></div><figcaption></figcaption>`;
      play.facing = { near, photos, shown: null };
      updateFacing();
      box.hidden = false;
      setPhotoPin(cellAtLatLng(near.ll));
      return;
    }
    if (photos.length) {
      const cap = document.createElement('figcaption');
      box.append(photoViewer(photos, (i) => {
        // photos[i].title already names the sol, e.g. "Sol 4996: Left Navigation Camera"
        const pin = state.activeView === 'map' ? '' : ', at the purple camera pin';
        cap.textContent = cap.title = `${photos[i].title}. Curiosity took this ${Math.round(near.d)} m from here${pin}.`;
      }));
      box.append(cap);
      box.hidden = false;
      setPhotoPin(cellAtLatLng(near.ll));     // pin where Curiosity stood for these photos (3D views)
      return;
    } else if (crop) {
      crop.className = 'full';
      box.append(crop);
      caption = `This spot from orbit (HiRISE, ${ORBITAL_VIEW_M} m across). Curiosity never stopped within ${PHOTO_RADIUS_M} m of here.`;
    } else { box.hidden = true; return; }
    const cap = document.createElement('figcaption');
    cap.textContent = cap.title = caption;
    box.append(cap);
    box.hidden = false;
  });
}

/** Photos further than this to the side of where you look count as "not this way". */
const FACING_MAX_OFF = 35;

/** The astronaut view turned (compass degrees, degrees above the horizon). */
export function lookedAt(az, el) {
  play.look = { az, el };
  if (play.facing) updateFacing();
}

/** Show the photo from Curiosity's stop that looks the way the astronaut looks. */
function updateFacing() {
  const f = play.facing, box = $('hPhoto');
  const { az, el } = play.look ?? { az: 0, el: 0 };
  const best = photoFacing(f.photos, f.near.p, az, el, f.shown);
  const a = box.querySelector('a'), img = box.querySelector('img'), none = box.querySelector('.facing-none');
  const badge = box.querySelector('.count'), cap = box.querySelector('figcaption');
  const looking = compassText(az);
  const pin = `from the purple camera pin, ${Math.round(f.near.d)} m from here`;
  if (best.off > FACING_MAX_OFF) {
    f.shown = null;
    a.hidden = true; none.hidden = false;
    const turn = turnTo(az, best.photo.look.az);
    none.textContent = `No Curiosity photo this way. Turn ${Math.round(Math.abs(turn))}° ${turn > 0 ? 'right' : 'left'} for one.`;
    badge.textContent = `Looking ${looking}`;
    cap.textContent = cap.title = `Curiosity photographed this stop on sol ${f.near.p.sol}, ${pin}.`;
    return;
  }
  a.hidden = false; none.hidden = true;
  if (best.photo === f.shown) return;
  f.shown = best.photo;
  const ph = best.photo, dir = compassText(ph.look.az);
  a.href = img.src = ph.url;
  img.alt = `${ph.title}, looking ${dir}`;
  badge.textContent = `Looking ${dir}`;
  // ph.title already names the sol, e.g. "Sol 4996: Left Navigation Camera"
  cap.textContent = cap.title = `What you're facing: ${ph.title}, looking ${dir}, taken ${pin}.`;
}

/** Redraw the picture after the view changed (each view shows the photos its own way). */
export function refreshAreaPicture() {
  if (play.tl && !$('hud').hidden) renderPlayback();
}
