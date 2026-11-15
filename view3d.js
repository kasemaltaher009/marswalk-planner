/* MarsWalk Planner — 3D terrain view (three.js).
 * The 1 m DEM (via cost_grid.json's 5 m elevations) becomes a mesh, the HiRISE photo
 * (plus any active overlays) is draped on it, and routes, markers and the astronaut
 * are drawn on top. Around it, lower-detail ground reaches 15 km out (context_elev.png +
 * context.jpg) and fades into the dusty haze, so the area is not a cut-out block.
 * The first time it opens, the view flies in from a Mars globe (globe3d.js).
 * Loaded by js/view3dBridge.js the first time the 3D tab is opened.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGlobe, latLonToVec } from './globe3d.js';

const EXAGGERATION = 1.5;   // vertical exaggeration so the relief reads at a glance
const MESH_STEP = 1;        // mesh vertex on every grid cell (5 m), so eye-level views sit on the ground
const SKY = '#c99f78';      // Mars daytime sky
const DUST = '#7a4e34';     // ground beyond the planning area (only if the surroundings fail to load)
// Astronaut-view camera height above the ground. Higher than a real eye (~1.7 m) on purpose: the
// ground is a 5 m mesh under a 2 m/px photo, so at true height the blurry patch at your feet fills
// the bottom of the screen and it feels like lying on the ground. At 8 it reads as standing.
const EYE_M = 8;

/** config: config.json (its `context`, `globe` and `center` parts are used here).
 *  onMode('globe' | 'local') tells the page when the view switches between the globe and the terrain. */
export function createView3D(container, { grid, onPick, config = null, dataUrl = 'data/', onMode = () => {}, onLook = () => {} }) {
  const { W, H, cell, elev } = grid;
  const size = W * cell;
  const S = size / 2000;          // overview sizes were tuned for a 2 km area; scale them with it
  let minE = Infinity;
  for (const e of elev) if (e < minE) minE = e;

  // grid (row r, col c — fractional allowed) → world. x = east, z = south, y = up.
  const worldX = (c) => (c + 0.5) * cell - size / 2;
  const worldZ = (r) => (r + 0.5) * cell - size / 2;
  const elevAt = (r, c) => {
    const v = elev[Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))];
    return Number.isFinite(v) ? v : minE;
  };
  function heightAt(r, c) {      // bilinear
    const r0 = Math.floor(r), c0 = Math.floor(c), fr = r - r0, fc = c - c0;
    const e = elevAt(r0, c0) * (1 - fr) * (1 - fc) + elevAt(r0, c0 + 1) * (1 - fr) * fc +
              elevAt(r0 + 1, c0) * fr * (1 - fc) + elevAt(r0 + 1, c0 + 1) * fr * fc;
    return (e - minE) * EXAGGERATION;
  }
  const toWorld = (r, c, lift = 0) => new THREE.Vector3(worldX(c), heightAt(r, c) + lift, worldZ(r));
  const rcOf = (idx) => [Math.floor(idx / W), idx % W];

  // ---- renderer, scene, camera ----
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.append(renderer.domElement);

  // Overview haze: the map area stays clear, the far edge of the surroundings fades into the sky.
  // Astronaut view: lighter near haze, the slopes of Mount Sharp still show kilometres away.
  const FOG = { near: 1600 * S, far: 8000 * S }, POV_FOG = { near: 250, far: 10000 };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, FOG.near, FOG.far);

  // from the south, looking north over the area: north is up and east is right, like the 2D map
  const centreY = heightAt((H - 1) / 2, (W - 1) / 2);   // the camera orbits a point on the ground
  const HOME = { pos: new THREE.Vector3(0, centreY + 1900 * S, 1800 * S), target: new THREE.Vector3(0, centreY, 0) };
  const camera = new THREE.PerspectiveCamera(45, 1, 5, 40000 * S);
  camera.position.copy(HOME.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.42;      // stay above the ground
  controls.minDistance = 120;
  controls.maxDistance = 4000 * S;    // stay well inside the surroundings, so their edge stays in the haze

  scene.add(new THREE.HemisphereLight('#fff1e0', '#5a3a28', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.3);
  sun.position.set(-1500, 1800, -700);   // from the north-west, like the hillshade
  scene.add(sun);

  // ---- terrain mesh (one vertex every MESH_STEP cells) ----
  const N = Math.floor(W / MESH_STEP);
  const baseY = -30;
  const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
  const meshRC = (i) => i * MESH_STEP + (MESH_STEP - 1) / 2;
  // the outermost vertices sit on the area's true edge (not half a cell inside), so the
  // surroundings meet the map area without a gap
  const meshX = (j) => (j === 0 ? -size / 2 : j === N - 1 ? size / 2 : worldX(meshRC(j)));
  const meshZ = (i) => (i === 0 ? -size / 2 : i === N - 1 ? size / 2 : worldZ(meshRC(i)));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const v = i * N + j;
      pos[v * 3] = meshX(j);
      pos[v * 3 + 1] = heightAt(meshRC(i), meshRC(j));
      pos[v * 3 + 2] = meshZ(i);
      uv[v * 2] = (meshX(j) + size / 2) / size;
      uv[v * 2 + 1] = 1 - (meshZ(i) + size / 2) / size;
    }
  }
  const index = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      const v = i * N + j;
      index.push(v, v + N, v + 1, v + 1, v + N, v + N + 1);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setIndex(index);
  geom.computeVertexNormals();

  const canvas = document.createElement('canvas');
  // about one texture pixel per photo pixel (2 m), within what the graphics card allows
  canvas.width = canvas.height = Math.min(renderer.capabilities.maxTextureSize, 2048);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const terrain = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ map: texture }));
  scene.add(terrain);

  /** Walls hanging from the terrain edge down to bottom(y). Until the surroundings load they reach
   *  the base (a solid block); after that they are a short skirt that hides the thin seam. */
  function edgeWalls(bottom) {
    const wall = [];
    const edges = [
      Array.from({ length: N }, (_, j) => [0, j]),          // north
      Array.from({ length: N }, (_, j) => [N - 1, j]),      // south
      Array.from({ length: N }, (_, i) => [i, 0]),          // west
      Array.from({ length: N }, (_, i) => [i, N - 1]),      // east
    ];
    for (const edge of edges) {
      for (let k = 0; k + 1 < edge.length; k++) {
        const [a, b] = [edge[k], edge[k + 1]].map(([i, j]) => [meshX(j), heightAt(meshRC(i), meshRC(j)), meshZ(i)]);
        wall.push(...a, ...b, a[0], bottom(a[1]), a[2], ...b, b[0], bottom(b[1]), b[2], a[0], bottom(a[1]), a[2]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wall), 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#5b3b2a', side: THREE.DoubleSide }));
  }
  let walls = edgeWalls(() => baseY);
  scene.add(walls);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60000 * S, 60000 * S), new THREE.MeshLambertMaterial({ color: DUST }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = baseY - 1;
  scene.add(ground);

  // ---- surroundings: lower-detail ground 15 km out, with a hole where the map area sits ----
  let surroundHeight = null;               // (x, z) → ground height there, once loaded
  /** Ground height under world (x, z): the map area, its surroundings, or the plain beyond. */
  function groundAt(x, z) {
    if (Math.abs(x) <= size / 2 && Math.abs(z) <= size / 2) return heightAt((z + size / 2) / cell - 0.5, (x + size / 2) / cell - 0.5);
    return surroundHeight ? surroundHeight(x, z) : baseY;
  }
  async function loadSurroundings() {
    const cc = config?.context;
    if (!cc) return;
    const [bmp, tex] = await Promise.all([
      fetch(dataUrl + 'context_elev.png')
        .then((res) => { if (!res.ok) throw new Error(`context_elev.png: ${res.status}`); return res.blob(); })
        // raw pixel values (no colour management): they are heights, not colours
        .then((blob) => createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })),
      new THREE.TextureLoader().loadAsync(dataUrl + 'context.jpg'),
    ]);
    const n = cc.points, step = cc.step_m, half = cc.size_m / 2;
    const cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const px = cx.getImageData(0, 0, n, n).data;
    // mesh points lo..hi (both ways) lie inside or on the edge of the map area
    const lo = Math.round((half - size / 2) / step), hi = Math.round((half + size / 2) / step);
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    let lowest = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = i * n + j, x = -half + j * step, z = -half + i * step;
        // on the map area's edge, take the detailed heights, so both meshes meet
        const y = i >= lo && i <= hi && j >= lo && j <= hi
          ? heightAt((z + size / 2) / cell - 0.5, (x + size / 2) / cell - 0.5)
          : (cc.elev_base_m + (px[v * 4] * 256 + px[v * 4 + 1]) * cc.elev_step_m - minE) * EXAGGERATION;
        pos.set([x, y, z], v * 3);
        uv.set([j / (n - 1), 1 - i / (n - 1)], v * 2);
        if (y < lowest) lowest = y;
      }
    }
    surroundHeight = (x, z) => {          // bilinear on the mesh points (for keeping the camera above ground)
      const fi = Math.min(n - 1.001, Math.max(0, (z + half) / step)), fj = Math.min(n - 1.001, Math.max(0, (x + half) / step));
      const i = Math.floor(fi), j = Math.floor(fj), di = fi - i, dj = fj - j, y = (ii, jj) => pos[(ii * n + jj) * 3 + 1];
      return y(i, j) * (1 - di) * (1 - dj) + y(i, j + 1) * (1 - di) * dj + y(i + 1, j) * di * (1 - dj) + y(i + 1, j + 1) * di * dj;
    };
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        if (i >= lo && i < hi && j >= lo && j < hi) continue;          // the map area's hole
        const v = i * n + j;
        index.push(v, v + n, v + 1, v + 1, v + n, v + n + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // both sides drawn: where the two meshes meet a few metres apart, the gap shows ground, not sky
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide })));

    // beyond the surroundings: plain ground in their average colour, below them, lost in the haze
    const [r, gr, b] = cc.ground_rgb;
    ground.material.color.setRGB(r / 255, gr / 255, b / 255, THREE.SRGBColorSpace);
    ground.position.y = lowest - 30;
    ground.scale.setScalar(4);
    scene.remove(walls);
    walls.geometry.dispose();
    walls = edgeWalls((y) => y - 25);
    scene.add(walls);
  }
  loadSurroundings().catch((err) => console.warn('3D surroundings not loaded:', err));

  // ---- texture: base photo + overlays, composed on a canvas ----
  const images = new Map();
  const loadImage = (url) => {
    if (!images.has(url)) {
      images.set(url, new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      }));
    }
    return images.get(url);
  };
  let textureJob = 0;
  async function setTexture(layers) {
    const job = ++textureJob;
    const imgs = await Promise.all(layers.map((l) => loadImage(l.url)));
    if (job !== textureJob) return;    // a newer request won
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    imgs.forEach((im, i) => {
      ctx.globalAlpha = layers[i].opacity;
      ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
    });
    ctx.globalAlpha = 1;
    texture.needsUpdate = true;
  }

  // ---- routes ----
  const routeGroup = new THREE.Group();
  scene.add(routeGroup);
  const clear = (group) => {
    for (const obj of [...group.children]) {
      obj.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
      group.remove(obj);
    }
  };
  /** A tube along fractional grid points [[r, c], …], lifted above the ground.
   *  `offset` (metres) shifts it to the right of the direction of travel: a lane. */
  function tube(rc, { radius, lift, color, opacity = 1, offset = 0 }) {
    const n = rc.length;
    if (n < 2) return null;
    const o = offset / cell;
    const pts = rc.map(([r, c], k) => {
      if (o) {
        const [r0, c0] = rc[Math.max(0, k - 1)], [r1, c1] = rc[Math.min(n - 1, k + 1)];
        const len = Math.hypot(r1 - r0, c1 - c0) || 1;
        r += (c1 - c0) / len * o;          // right of travel, seen from above (north up)
        c -= (r1 - r0) / len * o;
      }
      return toWorld(r, c, lift);
    });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geo = new THREE.TubeGeometry(curve, Math.min(6000, n * 3), radius, 6, false);
    const see = opacity < 1;
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: see, opacity, depthWrite: !see }));
  }
  const sample = (cells, step) => {
    const out = [];
    for (let k = 0; k < cells.length; k += step) out.push(rcOf(cells[k]));
    if ((cells.length - 1) % step) out.push(rcOf(cells[cells.length - 1]));
    return out;
  };

  // Route legs. Overview: every leg in its own coloured lane, plus the ghost route.
  // Astronaut view: only the leg being walked, as one thin cyan line.
  const POV_COLOR = '#62d6e8';
  let routeList = [];
  let activeLeg = 0;
  function setRoutes(list) {
    routeList = list;
    clear(routeGroup);
    if (pov) {
      const item = list.find((it) => it.leg === activeLeg) ?? list.find((it) => !it.ghost);
      if (!item) return;
      const line = tube(sample(item.path, 1), { color: POV_COLOR, radius: 0.2, lift: 1 });
      if (line) routeGroup.add(line);
      return;
    }
    for (const { path, color, radius, opacity = 1, lane } of list) {
      const mesh = tube(sample(path, 2), { color, opacity, radius: radius * S, lift: radius * S + 2, offset: lane ? 6 * S : 0 });
      if (mesh) routeGroup.add(mesh);
    }
  }
  /** Which leg the astronaut is on (the astronaut view shows only that one). */
  function setActiveLeg(i) {
    if (i === activeLeg) return;
    activeLeg = i;
    if (pov) setRoutes(routeList);
  }

  // Curiosity's drive path: faint off-white tracks, so it reads as context, not as a route.
  const traverseGroup = new THREE.Group();
  scene.add(traverseGroup);
  let traverseList = [];
  function setTraverse(lines) {
    traverseList = lines;
    clear(traverseGroup);
    for (const rc of lines) {
      const mesh = tube(rc, pov
        ? { radius: 0.12, lift: 0.6, color: '#efe8dc', opacity: 0.35 }
        : { radius: 1.6 * S, lift: 3, color: '#efe8dc', opacity: 0.4 });
      if (mesh) traverseGroup.add(mesh);
    }
  }

  // ---- markers: pole + numbered disc ----
  const markerGroup = new THREE.Group();
  scene.add(markerGroup);
  /** A round badge: a letter or number, or (with `draw`) a little picture drawn on it. */
  function labelSprite(text, color, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    ctx.fillStyle = '#1b1f24';
    if (draw) draw(ctx);
    else {
      ctx.font = '700 64px Saira, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 64, 68);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    s.scale.set(48, 48, 1);
    s.renderOrder = 10;
    return s;
  }
  const STAKE_M = 2;                 // astronaut view: badge height and the thin stake under the camera pin
  // Overview: big discs on 70 m poles. Astronaut view: badges about head height, sized on screen:
  // ~3% of its height when far, growing as you walk up to one (closer than POV_GROW_M), capped
  // at POV_MAX so even one right beside you never blocks the view (see sizePovLabels).
  const POV_MIN = 0.04, POV_MAX = 0.16, POV_GROW_M = 120;
  function sizeLabel(s) {
    s.material.sizeAttenuation = !pov;
    s.material.needsUpdate = true;
    const k = pov ? POV_MIN : 48 * S;
    s.scale.set(k, k, 1);
    s.position.y = pov ? STAKE_M : 95 * S;
  }
  /** A badge on a 70 m pole at grid cell idx. In the astronaut view the pole is hidden (it could
   *  stand right in front of the eye), unless `stake` asks for a thin one, like a pin in the ground. */
  function marker(idx, sprite, stake = false) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * S, 1.6 * S, 70 * S, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    pole.position.y = 35 * S;
    pole.userData.pole = true;
    pole.visible = !pov;
    g.add(pole);
    if (stake) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, STAKE_M, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      pin.position.y = STAKE_M / 2;
      pin.userData.stake = true;
      pin.visible = pov;
      g.add(pin);
    }
    sprite.userData.label = true;
    sizeLabel(sprite);
    g.add(sprite);
    g.position.copy(toWorld(...rcOf(idx)));
    return g;
  }
  /** Astronaut view, every frame: each badge's screen size from how far away it is. */
  function sizePovLabels() {
    for (const group of [markerGroup, pinGroup]) {
      for (const g of group.children) {
        const d = Math.hypot(g.position.x - camera.position.x, g.position.z - camera.position.z);
        const k = Math.min(POV_MAX, Math.max(POV_MIN, POV_MIN * POV_GROW_M / Math.max(d, 1)));
        for (const o of g.children) if (o.userData.label) o.scale.set(k, k, 1);
      }
    }
  }
  function setMarkers(list) {
    clear(markerGroup);
    for (const { idx, label, color } of list) markerGroup.add(marker(idx, labelSprite(label, color)));
  }

  // Where Curiosity stood when it took the photos shown in the helmet display: a camera pin.
  const pinGroup = new THREE.Group();
  scene.add(pinGroup);
  const drawCamera = (ctx) => {
    ctx.beginPath(); ctx.roundRect(30, 46, 68, 44, 8); ctx.fill();      // body
    ctx.fillRect(52, 38, 24, 10);                                        // viewfinder hump
    ctx.beginPath(); ctx.arc(64, 68, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();                              // lens
    ctx.beginPath(); ctx.arc(64, 68, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1f24'; ctx.fill();
  };
  let pinIdx = null;
  function setPhotoPin(idx) {
    if (idx === pinIdx) return;
    pinIdx = idx;
    clear(pinGroup);
    if (idx != null && idx >= 0) pinGroup.add(marker(idx, labelSprite('', '#9a86ff', drawCamera), true));
  }

  // ---- astronaut ----
  const astro = new THREE.Group();
  astro.scale.setScalar(S);
  const body = new THREE.Mesh(new THREE.SphereGeometry(15, 20, 14), new THREE.MeshBasicMaterial({ color: '#62d6e8' }));
  body.position.y = 30;
  const halo = new THREE.Mesh(new THREE.RingGeometry(22, 28, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 3;
  astro.add(body, halo);
  astro.visible = false;
  scene.add(astro);
  let follow = false;
  // Astronaut view: where the eye is and where it looks (smoothed in the render loop)
  const eyeGoal = new THREE.Vector3(), lookGoal = new THREE.Vector3(), lookNow = new THREE.Vector3();
  let hasEye = false;
  // Looking around in the astronaut view: the user's turn of the head on top of the walking direction
  let lookYaw = 0, lookPitch = 0;
  // the last view direction passed to onLook (compass degrees, degrees above the horizon)
  let told = null;

  /** Place the astronaut at grid (r, c), looking towards (lookR, lookC) along the route. */
  function setAstronaut(r, c, followIt = false, lookR = r, lookC = c) {
    if (r == null) { astro.visible = false; follow = false; return; }
    astro.position.copy(toWorld(r, c));
    astro.visible = !pov;
    follow = followIt;
    eyeGoal.copy(toWorld(r, c, EYE_M));
    // only turn the head if the look-ahead point is a real direction (not where we stand)
    if (Math.hypot(lookR - r, lookC - c) > 0.5) lookGoal.copy(toWorld(lookR, lookC, EYE_M));
    if (!hasEye) { camera.position.copy(eyeGoal); lookNow.copy(lookGoal); }
    hasEye = true;
  }

  // ---- astronaut view on/off: swap the orbit camera for a first-person one ----
  let pov = false;
  const saved = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  function setPOV(on) {
    if (on === pov) return;
    if (on) toLocalNow();                                // the astronaut stands on the terrain, not the globe
    pov = on;
    if (on) {
      saved.pos.copy(camera.position); saved.target.copy(controls.target);
      controls.enabled = false;
      camera.fov = 65; camera.near = 0.3; camera.far = 16000;
      scene.fog.near = POV_FOG.near; scene.fog.far = POV_FOG.far;   // dusty haze at ground level
      hasEye = false;                                    // jump (don't glide) to the eye on entry
      lookYaw = lookPitch = 0;
      told = null;
    } else {
      controls.enabled = true;
      camera.fov = 45; camera.near = 5; camera.far = 40000 * S;
      scene.fog.near = FOG.near; scene.fog.far = FOG.far;
      camera.position.copy(saved.pos); controls.target.copy(saved.target);
    }
    updateGlobeButton();
    camera.updateProjectionMatrix();
    astro.visible = hasEye && !pov;
    for (const group of [markerGroup, pinGroup]) {
      group.traverse((o) => {
        if (o.userData.pole) o.visible = !pov;
        if (o.userData.stake) o.visible = pov;
        if (o.userData.label) sizeLabel(o);
      });
    }
    setRoutes(routeList);
    setTraverse(traverseList);
  }

  // ---- Mars globe and the fly-in / fly-out between it and the terrain ----
  const el = renderer.domElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mode = 'local';                // 'globe' or 'local' (the terrain)
  const globe = config?.globe && config?.center
    ? createGlobe(renderer, el, { dataUrl, region: config.globe.region, site: config.center })
    : null;
  let globeOK = false;               // the globe image loaded
  // a dusty haze the camera passes through between the globe and the terrain
  const haze = document.createElement('div');
  haze.className = 'haze3d';
  const globeBtn = document.createElement('button');
  globeBtn.type = 'button';
  globeBtn.className = 'globe-btn';
  globeBtn.hidden = true;
  container.append(haze, globeBtn);
  globeBtn.addEventListener('click', () => (mode === 'local' ? flyOut() : flyIn()));

  function updateGlobeButton() {
    globeBtn.hidden = !globeOK || pov;
    globeBtn.textContent = mode === 'local' ? 'Zoom out to Mars' : 'Fly to Gale Crater';
    globeBtn.disabled = flying;
  }
  function setMode(m) {
    mode = m;
    if (globe) globe.controls.enabled = false;
    haze.style.opacity = 0;
    updateGlobeButton();
    onMode(m);
  }

  // One animation at a time, driven by the render loop. A click (or the astronaut view) skips
  // the rest of a flight: every remaining stage then jumps straight to its end.
  let anim = null, flying = false, skipping = false;
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  const easeOut = (k) => 1 - (1 - k) ** 3;
  function animate(ms, step) {
    if (skipping || reduceMotion) { step(1); return Promise.resolve(); }
    return new Promise((resolve) => { anim = { t0: performance.now(), ms, step, resolve }; });
  }
  function tick() {
    if (!anim) return;
    const k = Math.min(1, (performance.now() - anim.t0) / anim.ms);
    anim.step(k);
    if (k === 1) { const a = anim; anim = null; a.resolve(); }
  }
  function skipFlight() {
    if (!flying) return;
    skipping = true;
    if (anim) { const a = anim; anim = null; a.step(1); a.resolve(); }
  }
  function endFlight() { flying = skipping = false; updateGlobeButton(); }

  // the terrain camera, high above the area (all haze) and where it was before flying out
  const HIGH = { pos: new THREE.Vector3(0, 9000 * S, 1300 * S), target: HOME.target.clone() };
  let back = HOME;
  const ALT_LOW = 1.04, ALT_HIGH = 4.2;    // globe camera distance (Mars radii): over Gale / whole planet
  function moveCamera(from, to, e) {
    camera.position.lerpVectors(from.pos, to.pos, e);
    controls.target.lerpVectors(from.target, to.target, e);
    camera.lookAt(controls.target);
  }

  /** Globe → dive to Gale Crater → through the haze → down to the terrain. */
  async function flyIn() {
    if (!globeOK || mode !== 'globe' || flying) return;
    flying = true; updateGlobeButton();
    globe.controls.enabled = false;
    const d0 = globe.camera.position.length(), u0 = globe.camera.position.clone().normalize();
    await animate(2600, (k) => {
      const e = easeInOut(k);
      globe.pose(u0.clone().lerp(globe.siteDir, e), d0 * (ALT_LOW / d0) ** e);
      haze.style.opacity = Math.max(0, (k - 0.72) / 0.28);
    });
    setMode('local');
    haze.style.opacity = 1;
    controls.enabled = false;
    await animate(2800, (k) => {
      moveCamera(HIGH, back, easeOut(k));
      haze.style.opacity = Math.max(0, 1 - k / 0.4);
    });
    controls.enabled = !pov;
    endFlight();
  }

  /** Terrain → up into the haze → out to the whole planet. */
  async function flyOut() {
    if (!globeOK || mode !== 'local' || flying || pov) return;
    flying = true; updateGlobeButton();
    controls.enabled = false;
    back = { pos: camera.position.clone(), target: controls.target.clone() };
    await animate(1800, (k) => {
      moveCamera(back, HIGH, k ** 3);
      haze.style.opacity = Math.max(0, (k - 0.55) / 0.45);
    });
    if (pov) { haze.style.opacity = 0; endFlight(); return; }   // the astronaut view cut the flight short
    setMode('globe');
    haze.style.opacity = 1;
    await animate(2600, (k) => {
      globe.pose(globe.siteDir, ALT_LOW * (ALT_HIGH / ALT_LOW) ** easeOut(k));
      haze.style.opacity = Math.max(0, 1 - k / 0.35);
    });
    if (mode === 'globe') globe.controls.enabled = true;
    endFlight();
  }

  /** Straight to the terrain, without flying (the astronaut view needs it). */
  function toLocalNow() {
    if (!flying && mode === 'local') return;
    skipFlight();
    if (mode !== 'local') setMode('local');
    camera.position.copy(back.pos); controls.target.copy(back.target);   // not up in the haze
  }

  /** First opening: start on the globe, Gale Crater in view. The user spins it, then clicks
   *  Gale (or "Fly to Gale Crater") to fly down to the walk. */
  let introDone = false;
  async function intro() {
    introDone = true;
    if (!globe) return;
    const t0 = performance.now();
    try { await globe.ready; } catch (err) { console.warn('Mars globe not loaded:', err); return; }
    globeOK = true;
    updateGlobeButton();
    // not in the astronaut view, or if the globe came too late (the terrain is already showing)
    if (pov || flying || performance.now() - t0 > 1500) return;
    setMode('globe');
    globe.pose(latLonToVec(config.center.lat + 12, config.center.lon - 30), ALT_HIGH);
    globe.controls.enabled = true;
  }

  // ---- click on the ground → add a point (a drag is an orbit, not a click) ----
  const raycaster = new THREE.Raycaster();
  let down = null;
  let dragLook = null;               // astronaut view: drag to turn the head
  el.tabIndex = 0;                   // so the arrow keys can look around too
  el.addEventListener('pointerdown', (e) => {
    if (flying) { skipFlight(); down = null; return; }   // a click skips the flight
    down = [e.clientX, e.clientY];
    if (pov) { dragLook = [e.clientX, e.clientY]; el.setPointerCapture?.(e.pointerId); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!pov || !dragLook) return;
    // grab the scene and pull it: drag right turns the head left (like Street View)
    const k = (camera.fov * Math.PI / 180) / el.clientHeight;
    turnHead((e.clientX - dragLook[0]) * k, (e.clientY - dragLook[1]) * k);
    dragLook = [e.clientX, e.clientY];
  });
  const endLook = () => { dragLook = null; };
  el.addEventListener('pointercancel', endLook);
  el.addEventListener('lostpointercapture', endLook);
  el.addEventListener('dblclick', () => { if (pov) lookYaw = lookPitch = 0; });   // face the path again
  el.addEventListener('keydown', (e) => {
    if (!pov) return;
    const step = 0.12, keys = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (keys[e.key]) { turnHead(...keys[e.key]); e.preventDefault(); }
    else if (e.key === 'Home') { lookYaw = lookPitch = 0; e.preventDefault(); }
  });
  function turnHead(dYaw, dPitch) {
    lookYaw = Math.atan2(Math.sin(lookYaw + dYaw), Math.cos(lookYaw + dYaw));
    lookPitch = Math.max(-1.3, Math.min(1.3, lookPitch + dPitch));
  }
  el.addEventListener('pointerup', (e) => {
    endLook();
    if (pov || flying || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    if (mode === 'globe') { if (globe.hitsSite(ndc)) flyIn(); return; }
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(terrain)[0];
    if (!hit) return;
    const c = Math.min(W - 1, Math.max(0, Math.round((hit.point.x + size / 2) / cell - 0.5)));
    const r = Math.min(H - 1, Math.max(0, Math.round((hit.point.z + size / 2) / cell - 0.5)));
    onPick(r * W + c);
  });

  // ---- render loop (only while the 3D tab is visible) ----
  let running = false;
  const delta = new THREE.Vector3();
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    tick();
    if (pov && mode !== 'local') setMode('local');
    if (mode === 'globe') {
      if (globe.controls.enabled) globe.controls.update();
      globe.render();
      return;
    }
    if (pov) {                          // first person: glide to the eye, turn the head smoothly
      camera.position.lerp(eyeGoal, 0.25);
      lookNow.lerp(lookGoal, 0.08);
      // walking direction, then the user's head turn on top of it
      delta.copy(lookNow).sub(camera.position);
      const yaw = Math.atan2(delta.x, delta.z) + lookYaw;
      const pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) + lookPitch));
      delta.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(delta.add(camera.position));
      // tell the page which way the astronaut looks (x = east, z = south, so north is -z)
      const az = (180 - yaw * 180 / Math.PI + 720) % 360, el = pitch * 180 / Math.PI;
      if (!told || Math.abs(((az - told.az + 540) % 360) - 180) > 2 || Math.abs(el - told.el) > 2) {
        told = { az, el };
        onLook(az, el);
      }
      sizePovLabels();
      renderer.render(scene, camera);
      return;
    }
    if (flying) { renderer.render(scene, camera); return; }   // the flight moves the camera
    if (follow && astro.visible) {      // glide the camera along with the astronaut
      delta.copy(astro.position).sub(controls.target).multiplyScalar(0.06);
      controls.target.add(delta);
      camera.position.add(delta);
    }
    controls.update();
    // never orbit into a hillside (Mount Sharp rises kilometres above the area to the south-east)
    const floor = groundAt(camera.position.x, camera.position.z) + 60 * S;
    if (camera.position.y < floor) camera.position.y = floor;
    renderer.render(scene, camera);
  }
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    globe?.resize(w / h);
  }
  new ResizeObserver(resize).observe(container);

  return {
    setTexture, setRoutes, setActiveLeg, setTraverse, setMarkers, setPhotoPin, setAstronaut, setPOV, resize,
    start() {
      if (running) return;
      running = true; resize(); frame();
      if (!introDone) intro();
    },
    stop() { running = false; },
    get mode() { return mode; },
  };
}
