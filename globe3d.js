/* MarsWalk Planner — Mars globe for the 3D fly-in (three.js).
 * The whole planet from NASA's Viking colour mosaic (mars_globe.jpg), a sharper patch around
 * Gale Crater (gale_region.jpg) for the zoom-in, a thin dusty atmosphere and a marker on the
 * walk area. Used by view3d.js, which owns the renderer and the fly-in/fly-out animation.
 * Units: Mars radius = 1.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const D2R = Math.PI / 180;

/** lat/lon (degrees) → point on a sphere, matching THREE.SphereGeometry's texture layout
 *  (an equirectangular image with longitude −180 at its left edge, north at the top). */
export function latLonToVec(lat, lon, r = 1) {
  const phi = (lon + 180) * D2R, theta = (90 - lat) * D2R;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
}

/** A canvas texture: a soft-edged white square, so the sharp Gale patch blends into the globe. */
function softEdges(px = 128, edge = 0.3) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(px, px);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const d = Math.min(x, px - 1 - x, y, px - 1 - y) / (px - 1);
      const t = Math.min(1, d / edge), a = Math.round(255 * t * t * (3 - 2 * t));
      img.data.set([a, a, a, 255], (y * px + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

/** The walk-area marker: a ring with a name next to it, always the same size on screen. */
function siteSprites() {
  const ring = document.createElement('canvas');
  ring.width = ring.height = 128;
  let ctx = ring.getContext('2d');
  ctx.lineWidth = 10; ctx.strokeStyle = '#62d6e8';
  ctx.beginPath(); ctx.arc(64, 64, 44, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#62d6e8';
  ctx.beginPath(); ctx.arc(64, 64, 10, 0, Math.PI * 2); ctx.fill();

  const label = document.createElement('canvas');
  label.width = 512; label.height = 160;
  ctx = label.getContext('2d');
  ctx.font = '700 64px Saira, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff'; ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = 12;
  ctx.fillText('Gale Crater', 8, 70);
  ctx.font = '500 40px Saira, system-ui, sans-serif';
  ctx.fillStyle = '#d6e9ee';
  ctx.fillText('Click to fly to the walk', 8, 130);

  const sprite = (canvas, h, center) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false }));
    s.scale.set(h * canvas.width / canvas.height, h, 1);
    s.center.copy(center);
    s.renderOrder = 5;
    return s;
  };
  return [sprite(ring, 0.05, new THREE.Vector2(0.5, 0.5)), sprite(label, 0.06, new THREE.Vector2(-0.12, 0.5))];
}

export function createGlobe(renderer, dom, { dataUrl, region, site }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05060a');
  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 60);
  const controls = new OrbitControls(camera, dom);
  controls.enabled = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.rotateSpeed = 0.45;
  controls.minDistance = 1.25;
  controls.maxDistance = 6;

  const siteDir = latLonToVec(site.lat, site.lon).normalize();

  // sunlight from the upper left of Gale, so the crater is lit and the limb has a terminator
  scene.add(new THREE.AmbientLight('#ffffff', 0.55));
  const sun = new THREE.DirectionalLight('#fff4e8', 2.2);
  sun.position.copy(latLonToVec(site.lat + 30, site.lon - 55, 10));
  scene.add(sun);

  const loader = new THREE.TextureLoader();
  const load = (name) => loader.loadAsync(dataUrl + name).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  });

  const planetMat = new THREE.MeshLambertMaterial({ color: '#b5704a' });   // until the image arrives
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), planetMat));

  // sharper patch around Gale Crater, lifted a hair above the globe and faded at its edges
  const { west, east, south, north } = region;
  const patchMat = new THREE.MeshLambertMaterial({
    transparent: true, opacity: 0, alphaMap: softEdges(), depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const patch = new THREE.Mesh(new THREE.SphereGeometry(1.0002, 48, 48,
    (west + 180) * D2R, (east - west) * D2R, (90 - north) * D2R, (north - south) * D2R), patchMat);
  scene.add(patch);

  // thin dusty atmosphere: a glow just outside the limb
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 48), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color('#e9a27a') } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 p = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
      void main() { float d = abs(dot(vN, vV)); float a = pow(clamp(d * 3.2, 0.0, 1.0), 2.2) * 0.85;
        gl_FragColor = vec4(color * a, a); }`,
  }));
  scene.add(glow);

  // a few stars
  const starPos = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(40);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#cfd6e6', size: 1.4, sizeAttenuation: false })));

  // marker on the walk area
  const marker = new THREE.Group();
  for (const s of siteSprites()) marker.add(s);
  marker.position.copy(siteDir).multiplyScalar(1.004);
  scene.add(marker);

  const ready = Promise.all([
    load('mars_globe.jpg').then((t) => { planetMat.map = t; planetMat.color.set('#ffffff'); planetMat.needsUpdate = true; }),
    load('gale_region.jpg').then((t) => { patchMat.map = t; patchMat.opacity = 1; patchMat.needsUpdate = true; }).catch(() => {}),
  ]);

  /** Put the camera `dist` radii from the centre, in direction `dir`, looking at the centre. */
  function pose(dir, dist) {
    camera.position.copy(dir).normalize().multiplyScalar(dist);
    controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
  }

  const raycaster = new THREE.Raycaster();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const hitPt = new THREE.Vector3();
  /** True if a click at ndc landed on (or right next to) Gale Crater or its label. */
  function hitsSite(ndc) {
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObject(marker, true).length) return true;
    if (!raycaster.ray.intersectSphere(sphere, hitPt)) return false;
    return hitPt.normalize().angleTo(siteDir) < 4 * D2R;   // within ~240 km of the site
  }

  function render() {
    // keep the near plane close to the surface, so the patch and globe don't flicker
    const alt = camera.position.length() - 1;
    camera.near = Math.max(0.0004, alt * 0.4);
    camera.updateProjectionMatrix();
    // hide the label when Gale is round the back of the planet, or when it would cover the close-up
    const facing = camera.position.dot(siteDir) / camera.position.length();
    marker.visible = alt > 0.12 && facing > 1 / camera.position.length() + 0.05;
    renderer.render(scene, camera);
  }

  return {
    camera, controls, siteDir, ready, pose, hitsSite, render,
    resize(aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); },
  };
}
