/* Ariadne (Marswalk planner) — the astronaut figure for the 3D view (three.js shapes, no model file).
 * Made to replace the cyan "walking sphere" in view3d.js: about 62 units tall before view3d's `M`
 * scale (≈ 3 cm per unit, so a 1.9 m suited person), feet at y = 0, facing +z. Turn it to face a
 * direction with `figure.rotation.y = Math.atan2(dx, dz)` (dx east, dz south).
 * figure.userData.walk(phase, amount): swing arms and legs; phase in radians (one stride = 2π),
 * amount 0 = standing still, 1 = full stride.
 *
 * Modelled loosely on a modern planetary EVA suit: hard upper torso, fabric limbs with ribbed
 * (bellows) joints, bubble helmet with a gold sun visor, life-support backpack with hoses to the
 * chest control box, fingered gloves and treaded boots. Fabric gets a generated weave texture.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SUIT = '#efece6';       // white outer fabric
const SOFT = '#dcd7ce';       // joints and bellows, a shade darker
const METAL = '#a9adb3';      // bearings, neck ring, buckles
const DARK = '#2b2e34';
const RUBBER = '#4a4c51';
const ID_RED = '#c0392b';     // the red ID stripes real crews wear
const VISOR = '#d6a640';      // gold sun visor
const LIGHT = '#62d6e8';      // status lights: the app's walker cyan

// ---- generated textures (made once, shared) ----
let tex = null;
function textures() {
  if (tex) return tex;
  const canvas = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // woven fabric: fine cross-hatch + speckle, tiled
  const weave = canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 4) {
      g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(i, 0, 1, h);
      g.fillStyle = 'rgba(0,0,0,0.04)'; g.fillRect(0, i, w, 1);
    }
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1, 1);
    }
  });
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(4, 4);
  // sky-and-ground picture the visor and helmet bubble reflect (the scene has no environment map)
  const env = canvas(256, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#f6dcc0'); grad.addColorStop(0.48, '#d9a57c');
    grad.addColorStop(0.52, '#7a4e34'); grad.addColorStop(1, '#3b2518');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff6e8';                                    // the sun
    g.beginPath(); g.arc(w * 0.3, h * 0.22, 6, 0, Math.PI * 2); g.fill();
  });
  env.mapping = THREE.EquirectangularReflectionMapping;
  // mission patch: red planet in a blue ring
  const patch = canvas(64, 64, (g) => {
    g.fillStyle = '#1d3b6e'; g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2efe9'; g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c4572e'; g.beginPath(); g.arc(32, 34, 15, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1d3b6e'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(32, 34, 23, 6, -0.3, 0, Math.PI * 2); g.stroke();
  });
  // chest display: a few lines of readout
  const screen = canvas(64, 32, (g) => {
    g.fillStyle = '#0d1a1f'; g.fillRect(0, 0, 64, 32);
    g.fillStyle = LIGHT;
    for (let i = 0; i < 4; i++) g.fillRect(5, 5 + i * 6, 18 + ((i * 23) % 30), 3);
    g.fillRect(50, 5, 9, 21);
  });
  tex = { weave, env, patch, screen };
  return tex;
}

export function createAstronaut() {
  const { weave, env, patch, screen } = textures();
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra });
  const fabric = std(SUIT, { map: weave, bumpMap: weave, bumpScale: 0.6 });
  const soft = std(SOFT, { map: weave, bumpMap: weave, bumpScale: 0.6 });
  const hard = std('#f4f2ee', { roughness: 0.45 });                   // fibreglass torso and helmet shell
  const metal = std(METAL, { metalness: 0.8, roughness: 0.35, envMap: env });
  const dark = std(DARK, { roughness: 0.6 });
  const rubber = std(RUBBER, { roughness: 0.95 });
  const red = std(ID_RED);
  const glow = std(LIGHT, { emissive: LIGHT, emissiveIntensity: 0.9 });
  const lampLens = std('#fff8e6', { emissive: '#fff1cc', emissiveIntensity: 0.8 });
  const visorMat = std(VISOR, { metalness: 1, roughness: 0.12, envMap: env, envMapIntensity: 1.4 });
  const bubble = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.2, roughness: 0.05, envMap: env, transparent: true, opacity: 0.22 });
  const palmMat = std('#6c7380', { roughness: 0.9 });

  const at = (o, x = 0, y = 0, z = 0) => { o.position.set(x, y, z); return o; };
  const mesh = (geo, m, x, y, z) => at(new THREE.Mesh(geo, m), x, y, z);
  const box = (w, h, d, r, m, x, y, z) => mesh(new RoundedBoxGeometry(w, h, d, 3, r), m, x, y, z);
  // a limb segment hanging down from its pivot: tapered tube from y = top to y = top - len
  const tube = (rTop, rBot, len, m, top = 0) => mesh(new THREE.CylinderGeometry(rTop, rBot, len, 20, 1), m, 0, top - len / 2, 0);
  // ribbed fabric joint: a stack of rings, centred on y
  const bellows = (r, n, gap, m, y = 0) => {
    const g = at(new THREE.Group(), 0, y, 0);
    for (let i = 0; i < n; i++) {
      const ring = mesh(new THREE.TorusGeometry(r, r * 0.22, 8, 22), m, 0, (i - (n - 1) / 2) * gap, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    g.add(mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, n * gap, 18), m));
    return g;
  };
  const band = (r, h, m, y) => mesh(new THREE.CylinderGeometry(r, r, h, 20), m, 0, y, 0);

  const figure = new THREE.Group();

  // ---- torso: hard upper torso (lathe), soft waist, brief ----
  const torso = at(new THREE.Group(), 0, 30, 0);
  figure.add(torso);
  const hut = new THREE.LatheGeometry([
    [0, -1], [6.6, -1], [7.4, 1], [8.8, 5], [9.5, 9], [9.6, 12.5], [9.0, 15.5], [7.6, 17.6], [5.8, 18.6], [0, 18.8],
  ].map(([r, y]) => new THREE.Vector2(r, y)), 32);
  const chest = mesh(hut, hard);
  chest.scale.z = 0.74;
  const waist = bellows(6.9, 4, 1.4, soft, -2);
  waist.scale.z = 0.78;
  const brief = mesh(new THREE.SphereGeometry(7.2, 24, 16, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), fabric, 0, -3.6, 0);
  brief.scale.set(1, 0.85, 0.8);
  const beltRing = band(7.25, 1.1, metal, -0.6);
  beltRing.scale.z = 0.78;
  torso.add(chest, waist, brief, beltRing);
  // seams on the chest shell
  for (const y of [5, 13]) {
    const seam = mesh(new THREE.TorusGeometry(y === 5 ? 8.85 : 9.55, 0.18, 6, 40), dark, 0, y, 0);
    seam.rotation.x = Math.PI / 2;
    seam.scale.y = 0.74;
    torso.add(seam);
  }

  // chest control box with knobs, screen and a hose to each side of the backpack
  const dcm = at(new THREE.Group(), 0, 8, 7.4);
  dcm.add(box(9, 5, 3, 0.8, hard, 0, 0, 0));
  const scr = mesh(new THREE.PlaneGeometry(4.6, 2.3), new THREE.MeshBasicMaterial({ map: screen }), -1.4, 0.6, 1.52);
  dcm.add(scr);
  for (const [x, y, r] of [[2.8, 0.9, 0.75], [2.8, -1.3, 0.6], [-2.4, -1.6, 0.5], [-0.6, -1.6, 0.5]]) {
    const knob = mesh(new THREE.CylinderGeometry(r, r, 0.9, 12), dark, x, y, 1.7);
    knob.rotation.x = Math.PI / 2;
    dcm.add(knob);
  }
  dcm.add(mesh(new THREE.SphereGeometry(0.35, 8, 6), glow, 1.2, 1.8, 1.5));
  torso.add(dcm);
  for (const side of [-1, 1]) {
    const hose = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 4.6, 7.4, 8.4), new THREE.Vector3(side * 8.4, 5.8, 7.6),
      new THREE.Vector3(side * 10, 4.2, 2), new THREE.Vector3(side * 8.4, 5, -6.5),
    ]);
    torso.add(mesh(new THREE.TubeGeometry(hose, 24, 0.75, 8), side < 0 ? std('#3a5b8c') : std('#8a8f96'), 0, 0, 0));
    torso.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.2, 12), metal, side * 4.6, 7.4, 8.4).rotateZ(Math.PI / 2));
  }
  // name tag
  torso.add(mesh(new THREE.PlaneGeometry(4.2, 1.2), std('#d8d2c4'), -4.6, 12.5, 7.15).rotateY(-0.42));

  // ---- life-support backpack ----
  const pack = at(new THREE.Group(), 0, 9, -9.6);
  pack.add(box(14, 17, 7, 1.6, hard, 0, 0, 0));
  pack.add(box(11.5, 3, 6, 1, hard, 0, 9.6, 0.2));                     // top unit
  pack.add(box(14.2, 1.6, 7.2, 0.5, red, 0, -5.6, 0));                // ID band
  for (let i = -2; i <= 2; i++) pack.add(mesh(new THREE.BoxGeometry(1, 6, 0.4), dark, i * 2, 1.5, -3.55));   // vent slats
  pack.add(box(5, 3, 1.4, 0.4, soft, -3.6, -2.6, -3.8));             // tool pouch
  pack.add(box(5, 3, 1.4, 0.4, soft, 3.6, -2.6, -3.8));
  const antenna = mesh(new THREE.CylinderGeometry(0.18, 0.25, 7, 6), dark, 5, 14.3, -1.5);
  pack.add(antenna, mesh(new THREE.SphereGeometry(0.5, 8, 6), dark, 5, 17.9, -1.5));
  pack.add(mesh(new THREE.SphereGeometry(0.75, 10, 8), glow, -4.6, 11.2, -2));
  torso.add(pack);

  // ---- helmet ----
  const head = at(new THREE.Group(), 0, 19.6, 0.3);
  torso.add(head);
  head.add(band(5.9, 1.6, metal, 0), band(6.15, 0.6, red, 0.9));      // neck ring
  const shell = mesh(new THREE.SphereGeometry(7.6, 32, 24), hard, 0, 5.6, -0.3);
  shell.scale.set(1, 1.04, 1.02);
  const visor = mesh(new THREE.SphereGeometry(7.72, 32, 24, Math.PI * 0.16, Math.PI * 0.68, Math.PI * 0.26, Math.PI * 0.4), visorMat, 0, 5.6, -0.3);
  visor.scale.copy(shell.scale);
  // sunshade over the visor
  const shade = mesh(new THREE.SphereGeometry(7.95, 32, 12, Math.PI * 0.2, Math.PI * 0.6, Math.PI * 0.2, Math.PI * 0.08), hard, 0, 5.6, -0.3);
  const glass = mesh(new THREE.SphereGeometry(8.05, 32, 24), bubble, 0, 5.6, -0.3);   // clear outer visor
  head.add(shell, visor, shade, glass);
  for (const side of [-1, 1]) {
    const lampBody = mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.6, 14), hard, side * 6.6, 9.4, 2.4);
    lampBody.rotation.x = Math.PI / 2;
    const lens = mesh(new THREE.CircleGeometry(1, 14), lampLens, side * 6.6, 9.4, 3.72);
    head.add(lampBody, lens);
  }
  const cam = box(1.8, 1.8, 3, 0.4, dark, 7.6, 7.2, 1.2);                // helmet camera
  head.add(cam, mesh(new THREE.CircleGeometry(0.6, 12), glow, 7.6, 7.2, 2.72));

  // ---- arms: shoulder pivot → elbow pivot → glove ----
  const glove = (side) => {
    const g = at(new THREE.Group(), 0, -9.2, 0.2);
    g.add(band(2.75, 1.8, metal, 0.4));                                 // wrist disconnect
    g.add(tube(2.6, 2.5, 2.2, fabric, -0.5));                          // gauntlet
    const hand = at(new THREE.Group(), 0, -3, 0);
    hand.add(box(4.6, 4.6, 3.2, 1.1, fabric, 0, -1.6, 0));            // back of hand (thick padded glove)
    hand.add(box(4, 4, 0.6, 0.25, palmMat, 0, -1.6, 1.45));            // palm grip pad
    for (let i = 0; i < 4; i++) {
      const finger = at(new THREE.Group(), (i - 1.5) * 1.12, -3.4, 0.5);
      finger.add(mesh(new THREE.CapsuleGeometry(0.62, 2 - Math.abs(i - 1.3) * 0.35, 4, 8), fabric, 0, -1.2, 0));
      finger.rotation.x = -0.35;                                         // relaxed curl
      hand.add(finger);
    }
    const thumb = at(new THREE.Group(), side * 2.1, -0.9, 0.6);        // ends up on the front once the hand turns
    thumb.add(mesh(new THREE.CapsuleGeometry(0.55, 1.6, 4, 8), fabric, 0, -1.2, 0));
    thumb.rotation.set(-0.5, 0, side * 0.6);
    hand.add(thumb);
    hand.rotation.y = -side * Math.PI / 2;                               // palms face the body
    g.add(hand);
    return g;
  };
  const arm = (side) => {
    const shoulder = at(new THREE.Group(), side * 10.4, 14.4, 0);
    shoulder.add(mesh(new THREE.SphereGeometry(4.1, 20, 14), fabric));
    const bearing = mesh(new THREE.TorusGeometry(3.5, 0.45, 8, 24), metal, -side * 2.2, 0, 0);
    bearing.rotation.y = Math.PI / 2;
    shoulder.add(bearing);
    const p = mesh(new THREE.CircleGeometry(1.9, 20), std('#ffffff', { map: patch }), side * 3.15, -1.8, 0);
    p.rotation.y = side * Math.PI / 2;
    shoulder.add(p);
    shoulder.add(bellows(3.4, 3, 1.2, soft, -4.4));
    shoulder.add(tube(3.3, 3.0, 5.2, fabric, -6));
    shoulder.add(band(3.15, 0.9, red, -8.2));
    const elbow = at(new THREE.Group(), 0, -11.8, 0);
    elbow.add(bellows(3.0, 4, 1.05, soft, 0));
    elbow.add(tube(2.95, 2.65, 7.4, fabric, -1.6));
    if (side < 0) {                                                       // wrist checklist on the left cuff
      const book = box(3.6, 3, 0.9, 0.3, std('#d8d2c4'), 0, -6.4, 2.9);
      book.rotation.x = -0.25;
      elbow.add(book);
    }
    elbow.add(glove(side));
    shoulder.add(elbow);
    shoulder.rotation.z = side * 0.14;                                    // bulky suit holds the arms out
    torso.add(shoulder);
    return { shoulder, elbow };
  };
  const armL = arm(-1), armR = arm(1);

  // ---- legs: hip pivot → knee pivot → boot ----
  const boot = () => {
    const b = at(new THREE.Group(), 0, -11.6, 0);
    b.add(bellows(3.3, 2, 1, soft, 0.6));                                 // ankle
    b.add(box(6.6, 5.4, 8.4, 1.6, hard, 0, -2.4, 0.9));                  // boot upper
    b.add(box(7, 1.2, 11.2, 0.5, rubber, 0, -4.3, 1.6));                 // sole
    b.add(box(6.4, 3, 3.4, 1.2, hard, 0, -3.2, 5.4));                    // toe cap
    for (let i = 0; i < 6; i++) b.add(mesh(new THREE.BoxGeometry(6.8, 0.5, 0.8), dark, 0, -4.95, -3.2 + i * 1.75));   // tread
    for (const y of [-0.8, -2.4]) b.add(mesh(new THREE.BoxGeometry(6.8, 0.5, 1.2), metal, 0, y, 4.6).rotateX(-0.6)); // buckles
    return b;
  };
  const leg = (side) => {
    const hip = at(new THREE.Group(), side * 4.3, 27.6, 0);
    hip.add(mesh(new THREE.SphereGeometry(4.3, 18, 12), fabric));
    hip.add(tube(4.25, 3.75, 10.5, fabric, -1));
    hip.add(band(4.05, 1, red, -5));
    hip.add(box(3, 3.6, 1.4, 0.4, soft, side * 3.9, -6.5, 0.6).rotateY(side * 0.5));   // thigh pocket
    const knee = at(new THREE.Group(), 0, -12.6, 0);
    knee.add(bellows(3.7, 3, 1.2, soft, 0));
    knee.add(tube(3.6, 3.15, 8.4, fabric, -1.8));
    knee.add(boot());
    hip.add(knee);
    figure.add(hip);
    return { hip, knee };
  };
  const legL = leg(-1), legR = leg(1);

  // cyan ground ring so the walker is easy to spot from high above (as the old marker's halo)
  const halo = mesh(new THREE.RingGeometry(14, 16.5, 48), new THREE.MeshBasicMaterial({ color: LIGHT, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }), 0, 0.6, 0);
  halo.rotation.x = -Math.PI / 2;
  figure.add(halo);

  figure.userData.walk = (phase, amount = 1) => {
    const s = Math.sin(phase) * amount, c = Math.cos(phase);
    // hips swing the legs; each knee bends while its leg swings forward
    legL.hip.rotation.x = -0.42 * s;
    legR.hip.rotation.x = 0.42 * s;
    // (legL reaches forward as sin rises, i.e. while cos > 0 — that's when its foot is lifted)
    legL.knee.rotation.x = amount * (0.08 + 0.7 * Math.max(0, c));
    legR.knee.rotation.x = amount * (0.08 + 0.7 * Math.max(0, -c));
    // arms swing against the legs, elbows a little bent like in a stiff pressurised suit
    armL.shoulder.rotation.x = 0.32 * s;
    armR.shoulder.rotation.x = -0.32 * s;
    armL.elbow.rotation.x = -0.35 - 0.2 * Math.max(0, -s);
    armR.elbow.rotation.x = -0.35 - 0.2 * Math.max(0, s);
    // bob: highest when the legs pass each other; lean a little into the walk
    const bob = Math.abs(c) * 0.8 * amount;
    torso.position.y = 30 + bob;
    legL.hip.position.y = legR.hip.position.y = 27.6 + bob;
    torso.rotation.x = 0.05 * amount;
    torso.rotation.y = -0.05 * s;     // shoulders turn against the hips
  };
  figure.userData.walk(0, 0);
  return figure;
}
