/* Switching between the map, the 3D terrain and the astronaut view, and keeping the 3D view
 * in step with the map (texture layers, markers, routes, Curiosity's drive path).
 * view3d.js (three.js) is loaded the first time a 3D view opens. */
import { state, $, setStatus, DATA, REDUCED_MOTION } from './state.js';
import { map, overlayOn, setOverlay } from './map.js';
import { addPoint, refreshHint } from './points.js';
import { placeAstronaut, lookedAt, refreshAreaPicture } from './playback.js';

let view3dLoading = null;
const MODE_STATUS = {
  local: '3D terrain: drag to orbit, scroll to zoom, click the ground to add a point.',
  globe: 'Mars globe: drag to spin, scroll to zoom. Click Gale Crater to fly down to the walk.',
};
let photoPin = null;    // where Curiosity took the photos in the helmet display (cell index or null)
// The slope layer has its own on/off setting in the astronaut view (off at first: it hides the ground).
let povSlope = false;
let otherSlope = null;  // the slope setting of the map and 3D views, kept while in the astronaut view

/** name: 'map', '3d' (orbit around the terrain) or 'pov' (astronaut's eye view of the walk). */
export function showView(name) {
  if (name === 'pov' && !state.plan) return;
  if (name === 'pov' && state.activeView !== 'pov') { otherSlope = overlayOn('slope'); setOverlay('slope', povSlope); }
  if (name !== 'pov' && state.activeView === 'pov') { povSlope = overlayOn('slope'); setOverlay('slope', otherSlope); }
  state.activeView = name;
  $('btnMap').setAttribute('aria-pressed', name === 'map');
  $('btn3D').setAttribute('aria-pressed', name === '3d');
  $('btnPOV').setAttribute('aria-pressed', name === 'pov');
  $('map').hidden = name !== 'map';
  $('view3d').hidden = name === 'map';
  $('readout').hidden = true;
  document.querySelector('.stage').dataset.view = name;   // CSS hides the layer toolbar in the astronaut view
  refreshAreaPicture();   // the astronaut view shows the photo of where you look, the others all photos
  refreshHint();
  if (name === 'map') {
    state.view3d?.stop();
    map.invalidateSize();
    // a 3D how-to left in the status line would be wrong here (route messages stay)
    const shown = $('status').textContent;
    if (Object.values(MODE_STATUS).includes(shown) || shown.startsWith('Astronaut view:') || shown.startsWith('Building the 3D')) {
      setStatus('Map: click to place your start, then up to three science targets.');
    }
    return;
  }
  if (!view3dLoading) {
    setStatus('Building the 3D terrain…');
    view3dLoading = import('../view3d.js')
      .then((m) => {
        state.view3d = m.createView3D($('view3d'), {
          grid: state.grid, config: state.config, dataUrl: DATA,
          onPick: (idx) => addPoint(idx),
          onLook: lookedAt,
          onLand: { landing: mapLanding, done: fadeToMap },   // the first fly-in ends on the map
          onMode: (mode) => {
            document.querySelector('.stage').dataset.globe = mode === 'globe';   // CSS hides the map layer buttons
            refreshHint();
            if (state.activeView === '3d') setStatus(MODE_STATUS[mode]);
          },
        });
        sync3DTexture(); sync3DMarkers(); sync3DRoutes(); sync3DTraverse();
        state.view3d.setPhotoPin(photoPin);
      })
      .catch((err) => {
        console.error(err);
        view3dLoading = null;
        setStatus('The 3D view could not load (it needs internet for three.js).', true);
        showView('map');
      });
  }
  view3dLoading.then(() => {
    const view3d = state.view3d;
    if (state.activeView === 'map') return;
    view3d.setPOV(state.activeView === 'pov');
    sync3DTexture();
    if (state.activeView === 'pov') {
      placeAstronaut();
      setStatus('Astronaut view: press Play walk to walk the route. Drag to look around, double-click to face the path again.');
    } else {
      setStatus(MODE_STATUS[view3d.mode] ?? MODE_STATUS.local);
    }
    view3d.resize();
    view3d.start();
  });
}

/** The first fly-in from the globe comes down to look straight at what the map shows, then fades
 *  over to the map. This opens the map at its starting view, still covered by the 3D view,
 *  and says what it shows (centre and height as fractions of the area, y from the north edge). */
function mapLanding() {
  const a = state.config.bounds;
  $('map').hidden = false;
  map.invalidateSize();
  map.setView([(a.north + a.south) / 2, (a.west + a.east) / 2], map.getMinZoom(), { animate: false });
  return mapView();
}
/** What the map shows right now (it is made visible, under the 3D view if that is showing). */
function mapView() {
  const a = state.config.bounds;
  $('map').hidden = false;
  map.invalidateSize();
  const b = map.getBounds();
  return {
    x: ((b.getWest() + b.getEast()) / 2 - a.west) / (a.east - a.west),
    y: (a.north - (b.getNorth() + b.getSouth()) / 2) / (a.north - a.south),
    h: (b.getNorth() - b.getSouth()) / (a.north - a.south),
  };
}
/** Fade the 3D view out over the map underneath, then switch to the map. */
function fadeToMap() {
  if (state.activeView !== '3d') return Promise.resolve();   // the user already picked another view
  const v = $('view3d');
  return new Promise((resolve) => {
    const finish = () => {
      if (state.activeView === '3d') showView('map');
      v.classList.remove('fading');
      resolve();
    };
    if (REDUCED_MOTION) { finish(); return; }
    v.classList.add('fading');
    setTimeout(finish, FADE_MS);
  });
}

// ---- Smooth switch between the map and the 3D terrain (the view buttons) ----
const FADE_MS = 500;   // matches the opacity transition of #view3d in style.css
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
let switching = false;

/** The view buttons. Map ↔ 3D terrain: the 3D camera glides to or from straight above what
 *  the map shows, and the two crossfade. Everything else switches at once. */
export async function switchView(name) {
  const from = state.activeView;
  if (switching || name === from) return;
  const smooth = state.view3d && !REDUCED_MOTION && ((from === 'map' && name === '3d') || (from === '3d' && name === 'map'));
  if (!smooth) { showView(name); return; }
  switching = true;
  try {
    if (name === 'map') {
      await state.view3d.toTopDown(mapView());   // the map is now visible under the 3D view
      await fadeToMap();
      state.view3d.restoreOrbit();
    } else {
      await mapTo3D();
    }
  } finally { switching = false; }
}

async function mapTo3D() {
  const view = mapView();
  const v = $('view3d');
  v.classList.add('fading');          // shown invisible…
  showView('3d');
  $('map').hidden = false;            // …over the map, which stays until the 3D view has faded in
  await view3dLoading;
  if (state.activeView !== '3d') { v.classList.remove('fading'); return; }
  const glide = state.view3d.fromTopDown(view);   // straight above the map's view from the first frame
  await nextFrame(); await nextFrame();
  v.classList.remove('fading');
  await new Promise((r) => setTimeout(r, FADE_MS));
  if (state.activeView === '3d') $('map').hidden = true;
  await glide;
}

/** The 3D views pin where Curiosity took the photos in the helmet display (null = no pin). */
export function setPhotoPin(idx) {
  photoPin = idx;
  state.view3d?.setPhotoPin(idx);
}

export function sync3DTexture() {
  if (!state.view3d) return;
  const base = document.querySelector('[data-base="relief"]').getAttribute('aria-pressed') === 'true' ? 'hillshade.png' : 'photo.jpg';
  const list = [{ url: DATA + base, opacity: 1 }];
  if (overlayOn('slope')) list.push({ url: DATA + 'slope.png', opacity: 0.7 });
  if (overlayOn('ground')) list.push({ url: DATA + 'ground.png', opacity: 0.8 });
  state.view3d.setTexture(list);
}

export function sync3DMarkers() {
  if (!state.view3d) return;
  // only the walk's own points: Curiosity's stops are map-only (the 3D views show its drive path)
  const list = state.points.map((pt, i) => ({ idx: pt.idx, label: i === 0 ? 'S' : String(i), color: i === 0 ? '#4cc38a' : '#d9b24c' }));
  state.view3d.setMarkers(list);
}

export function sync3DRoutes() {
  if (!state.view3d) return;
  const list = [];
  if (state.plan) {
    const { chosen, ghost } = state.plan;
    if (ghost && ghost.path.join() !== chosen.path.join()) list.push({ path: ghost.path, color: '#d9b24c', radius: 2, opacity: 0.8, ghost: true });
    // one tube per leg, each in its own lane (right of travel), coloured like on the map
    for (const leg of chosen.legs) list.push({ path: chosen.path.slice(leg.from, leg.to + 1), color: leg.color, radius: 3.5, lane: true, leg: leg.i });
  }
  state.view3d.setRoutes(list);
}

/** Curiosity's real drive path, drawn faintly on the 3D ground (follows the Curiosity layer toggle). */
export function sync3DTraverse() {
  if (!state.view3d) return;
  const lines = [];
  if (state.curiosity && overlayOn('curiosity')) {
    const { W, H, b } = state.grid;
    for (const f of state.curiosity.features) {
      if (f.geometry.type !== 'LineString') continue;
      lines.push(f.geometry.coordinates.map(([lng, lat]) =>
        [(b.north - lat) / (b.north - b.south) * H - 0.5, (lng - b.west) / (b.east - b.west) * W - 0.5]));
    }
  }
  state.view3d.setTraverse(lines);
}
