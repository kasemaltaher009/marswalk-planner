/* Guided tour for first-time users: a small card that points at one part of the app at a time.
 *
 * Two kinds of steps:
 *   - action steps (`done`) wait until the user has actually done the thing (fly down, place a
 *     start, play the walk) and then move on by themselves; a step already done is skipped;
 *     (`needs`: what must stay true meanwhile, e.g. being on the terrain, not the globe);
 *   - info steps (`target` + Next) explain a panel; they're skipped when that panel isn't on screen.
 * The tour starts by itself the first time (after the briefing, or once the data is in if the
 * briefing was already seen) and from the Tour button any time.
 * The card never blocks the app: the dimmed area and ring let clicks through.
 */
import { state, $, REDUCED_MOTION } from './state.js';
import { play } from './playback.js';

const SEEN_KEY = 'marswalk.tourSeen';
const onTerrain = () => state.activeView === 'map' || state.view3d?.mode === 'local';

const STEPS = [
  {
    title: 'Fly down to Gale Crater',
    text: 'This is Mars. Drag to spin the globe, then click the marked spot, Gale Crater, to fly down to the walking area.',
    done: onTerrain,
  },
  {
    title: 'Place your start',
    clearCentre: true,
    text: "Click the ground where the walk begins, the airlock or rover. The end of Curiosity's track is a good spot. Too steep there? The point moves to the nearest safe ground.",
    done: () => state.points.length >= 1,
    needs: onTerrain,
  },
  {
    title: 'Add a science target',
    clearCentre: true,
    text: 'Click somewhere you want to study. The planner finds the safest path around steep slopes, cliffs and sand. You can add up to three targets and drag any marker to move it.',
    done: () => state.points.length >= 2 && !!state.plan,
    needs: onTerrain,
  },
  {
    target: '#summary',
    title: 'Go or no-go',
    text: 'Each system (suit time, terrain, thermal, daylight, radiation) gives its call. Green means go, orange means go with caution, red means no-go; the orange and red ones say what to change.',
  },
  {
    target: '#statsBox',
    title: 'The walk in numbers',
    text: 'Distance, time outside, climb and radiation dose. Each coloured leg of the route is listed here in order. Click the verdict at the top to fold this card.',
  },
  {
    target: '#priority',
    ring: (el) => el.closest('section'),
    title: 'Fastest or safest?',
    text: 'Drag this slider to trade safety for speed. The gold line (dashed on the map) is the route from the other end of the slider, for comparison.',
  },
  {
    target: '.toolbar',
    title: 'See why the route bends',
    text: 'Turn on Slope or Sand and rock to see the ground the planner avoids. Curiosity shows the rover\'s real drive; click a purple stop to see its photos.',
  },
  {
    target: '.viewdock',
    title: 'Three ways to look',
    text: 'Map for planning, 3D terrain to see the hills, and Astronaut view to stand on the route at eye height.',
  },
  {
    target: '#btnPlay',
    title: 'Walk it',
    text: 'Press Play walk. The helmet display shows the clock, suit time left and air temperature. While you work at a target (or pause), it shows a photo of the spot: Curiosity\'s if it stopped nearby, else the view from orbit.',
    done: () => play.playing,
  },
  {
    target: '#btnPOV',
    title: 'Step into the astronaut view',
    clearCentre: true,
    text: 'You are watching from above. Click Astronaut view to walk the route at eye height and see the ground the way you would in your suit.',
    done: () => state.activeView === 'pov',
  },
  {
    title: 'You\'re walking on Mars',
    clearCentre: true,
    text: 'Drag to look around; double-click to face the path again. When you stop at a target where Curiosity took photos, the helmet display shows its photo of the way you are looking. "End walk" brings the panels back, and the Tour button at the top replays this tour.',
    last: true,
  },
];

let step = -1;
let raf = 0;
let card, ring;

const visible = (el) => !!el && el.getClientRects().length > 0;
const targetOf = (s) => (s.target ? document.querySelector(s.target) : null);
const ringOf = (s) => { const el = targetOf(s); return el && s.ring ? s.ring(el) : el; };

export function setupTour() {
  card = document.createElement('div');
  card.className = 'tour';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'tourTitle');
  card.hidden = true;
  card.innerHTML = `
    <p class="tour-count" id="tourCount"></p>
    <h3 id="tourTitle"></h3>
    <p class="tour-text" id="tourText" aria-live="polite"></p>
    <div class="tour-btns">
      <button type="button" class="tour-skip" id="tourSkip">Skip tour</button>
      <span class="tour-wait" id="tourWait">Your turn</span>
      <button type="button" class="primary" id="tourNext">Next</button>
    </div>`;
  ring = document.createElement('div');
  ring.className = 'tour-ring';
  ring.hidden = true;
  document.body.append(ring, card);

  $('tourSkip').addEventListener('click', () => endTour());
  $('tourNext').addEventListener('click', () => goTo(step + 1));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && step >= 0) endTour(); });
  $('btnTour').addEventListener('click', () => startTour());
}

/** First visit only (remembered in this browser). */
export function maybeStartTour() {
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch { /* private window: show it */ }
  if (!seen) startTour();
}

export function startTour() {
  goTo(0);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

function endTour() {
  step = -1;
  card.hidden = ring.hidden = true;
  cancelAnimationFrame(raf);
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* fine */ }
}

/** Show step i, skipping steps that are already done or whose panel isn't on screen. */
function goTo(i) {
  while (i < STEPS.length) {
    const s = STEPS[i];
    if (s.done?.()) { i++; continue; }
    if (!s.done && s.target && !visible(ringOf(s))) { i++; continue; }
    break;
  }
  if (i >= STEPS.length) { endTour(); return; }
  step = i;
  const s = STEPS[i];
  $('tourCount').textContent = `Step ${i + 1} of ${STEPS.length}`;
  $('tourTitle').textContent = s.title;
  $('tourText').textContent = s.text;
  $('tourNext').hidden = !!s.done;
  $('tourNext').textContent = s.last ? 'Done' : 'Next';
  $('tourWait').hidden = !s.done;
  $('tourSkip').hidden = !!s.last;
  card.hidden = false;
  const el = ringOf(s);
  if (visible(el)) el.scrollIntoView({ block: 'nearest', behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  if (!s.done) $('tourNext').focus({ preventScroll: true });
  place();
}

// Every frame while the tour runs: move on when an action step is done, and keep the card and
// ring next to their target (panels scroll, hide and resize, and the walk hides the side panels).
function loop() {
  if (step < 0) return;
  const s = STEPS[step];
  if (s.done?.()) goTo(step + 1);
  else if (s.needs && !s.needs()) goTo(0);   // back on the globe: "fly down" again
  if (step >= 0) place();
  raf = requestAnimationFrame(loop);
}

// What the card should never cover: the controls at the bottom centre (waypoints with Undo / Clear all,
// the player with its speed and Follow, the view switch, the helmet display), the layer buttons and
// the verdict card. Steps with `clearCentre` also keep the middle of the view free: that's where you
// click the start and targets (by Curiosity's track) and where the walk is seen.
const KEEP_CLEAR = ['#wpbar', '#work', '#player', '.viewdock', '#hud', '.toolbar > *', '#summary'];

function place() {
  const s = STEPS[step];
  const el = ringOf(s);
  const vw = innerWidth, vh = innerHeight, gap = 14, pad = 12;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const target = visible(el) ? el.getBoundingClientRect() : null;
  ring.hidden = !target;
  const spots = [];
  if (target) {
    const r = target;
    Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    // beside the target: right, left, above, below
    spots.push([r.right + gap, r.top + r.height / 2 - ch / 2], [r.left - gap - cw, r.top + r.height / 2 - ch / 2],
      [r.left + r.width / 2 - cw / 2, r.top - gap - ch], [r.left + r.width / 2 - cw / 2, r.bottom + gap]);
  }
  // then the corners of the view: top left (under the layer buttons), top right, bottom left, bottom right
  const st = document.querySelector('.stage').getBoundingClientRect();
  const tools = [...document.querySelectorAll('.toolbar > *')].filter(visible).map((e) => e.getBoundingClientRect().bottom);
  const top = Math.max(st.top + pad, ...tools.map((b) => b + 10));
  const bottom = Math.min(vh, st.bottom) - pad - ch;
  spots.push([st.left + pad, top], [st.right - pad - cw, top], [st.left + pad, bottom], [st.right - pad - cw, bottom]);

  // The first spot that covers none of the keep-clear boxes wins, else the one covering least.
  // (a box holding the target, like the verdict card around "the walk in numbers", counts as the target itself)
  const zones = KEEP_CLEAR.flatMap((q) => [...document.querySelectorAll(q)])
    .filter((e) => visible(e) && !(target && e.contains(el))).map((e) => e.getBoundingClientRect());
  // covering the very thing the step talks about counts 10× (on a phone something has to be covered)
  if (target) zones.push(Object.assign(target.toJSON(), { weight: 10 }));
  if (s.clearCentre) {
    zones.push({ left: st.left + st.width * 0.3, right: st.right - st.width * 0.3, top: st.top + st.height * 0.3, bottom: st.bottom - st.height * 0.3 });
    const astro = document.querySelector('.astro');   // the walker on the map, wherever it is
    if (visible(astro)) {
      const a = astro.getBoundingClientRect();
      zones.push({ left: a.left - 60, right: a.right + 60, top: a.top - 60, bottom: a.bottom + 60 });
    }
  }
  const covered = ([x, y]) => zones.reduce((sum, z) => sum + (z.weight ?? 1) *
    Math.max(0, Math.min(x + cw, z.right) - Math.max(x, z.left)) * Math.max(0, Math.min(y + ch, z.bottom) - Math.max(y, z.top)), 0);
  // a spot partly off screen is pushed back on (so the card stays near its target when it can)
  const onScreen = ([x, y]) => [Math.min(Math.max(x, pad), vw - cw - pad), Math.min(Math.max(y, pad), vh - ch - pad)];
  let best = null, least = Infinity;
  for (const p of spots.map(onScreen)) {
    const c = covered(p);
    if (c < least) { best = p; least = c; }
    if (!c) break;
  }
  card.style.left = `${Math.round(best[0])}px`;
  card.style.top = `${Math.round(best[1])}px`;
}
