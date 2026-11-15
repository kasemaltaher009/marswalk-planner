/* Guided tour for first-time users: a small card that points at one part of the app at a time.
 *
 * Two kinds of steps:
 *   - action steps (`done`) wait until the user has actually done the thing (fly down, place a
 *     start, play the walk) and then move on by themselves; a step already done is skipped;
 *     (`needs`: what must stay true meanwhile, e.g. being on the terrain, not the globe);
 *   - info steps (`target` + Next) explain a panel; they're skipped when that panel isn't on screen.
 * The tour starts by itself the first time (after the briefing) and from the Tour button any time.
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
    text: "Click the ground where the walk begins, the airlock or rover. The end of Curiosity's track is a good spot. Too steep there? The point moves to the nearest safe ground.",
    done: () => state.points.length >= 1,
    needs: onTerrain,
  },
  {
    title: 'Add a science target',
    text: 'Click somewhere you want to study. The planner finds the safest path around steep slopes, cliffs and sand. You can add up to three targets and drag any marker to move it.',
    done: () => state.points.length >= 2 && !!state.plan,
    needs: onTerrain,
  },
  {
    target: '#verdictBox',
    title: 'Go or no-go',
    text: 'Each system (suit time, daylight, cold, radiation, terrain) gives its call. All green means GO; anything orange or red tells you what to change.',
  },
  {
    target: '#statsBox',
    title: 'The walk in numbers',
    text: 'Distance, time outside, climb and radiation dose. Each coloured leg of the route is listed here in order.',
  },
  {
    target: '#priority',
    ring: (el) => el.closest('section'),
    title: 'Fastest or safest?',
    text: 'Drag this slider to trade safety for speed. The dashed gold line on the map is the route from the other end of the slider, compared in the table on the right.',
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
    text: 'Press Play walk. The helmet display shows the clock, suit time left, air temperature and what Curiosity saw nearby.',
    done: () => play.playing,
  },
  {
    title: 'You\'re walking on Mars',
    text: 'Drag to look around in the astronaut view. "End walk" brings the panels back. Open this tour again any time with the Tour button at the top.',
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

function place() {
  const s = STEPS[step];
  const el = ringOf(s);
  const vw = innerWidth, vh = innerHeight, gap = 14, pad = 12;
  const cw = card.offsetWidth, ch = card.offsetHeight;
  let x, y;
  if (visible(el)) {
    const r = el.getBoundingClientRect();
    ring.hidden = false;
    Object.assign(ring.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` });
    // beside the target if there's room (right, left, below, above), else over the view's bottom
    const spots = [
      [r.right + gap, r.top + r.height / 2 - ch / 2, vw - r.right - gap >= cw + pad],
      [r.left - gap - cw, r.top + r.height / 2 - ch / 2, r.left - gap >= cw + pad],
      [r.left + r.width / 2 - cw / 2, r.bottom + gap, vh - r.bottom - gap >= ch + pad],
      [r.left + r.width / 2 - cw / 2, r.top - gap - ch, r.top - gap >= ch + pad],
    ];
    const fit = spots.find((p) => p[2]);
    if (fit) [x, y] = fit;
  } else {
    ring.hidden = true;
  }
  if (x === undefined) {
    // no target (or no room): just above the view buttons (and the player and helmet display during
    // a walk), so the middle of the view, where the walk starts by Curiosity, stays free to click
    const st = document.querySelector('.stage').getBoundingClientRect();
    const bottom = Math.min(...['.viewdock', '#player', '#hud'].map((q) => document.querySelector(q))
      .filter(visible).map((e) => e.getBoundingClientRect().top));
    x = st.left + st.width / 2 - cw / 2;
    y = bottom - gap - ch;
  }
  card.style.left = `${Math.round(Math.min(Math.max(x, pad), vw - cw - pad))}px`;
  card.style.top = `${Math.round(Math.min(Math.max(y, pad), vh - ch - pad))}px`;
}
