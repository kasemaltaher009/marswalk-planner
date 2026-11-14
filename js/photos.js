/* Photos: Curiosity's raw images from NASA (live, needs internet), the popup grid,
 * the previous/next photo viewer, and the orbital close-up from our HiRISE photo. */
import { DATA, state } from './state.js';

const photoCache = new Map();

const PHOTO_PAGE = 200;   // NASA's raw-image service returns at most 200 items per request
const PHOTO_PAGES = 5;    // so up to 1000 photos per sol

/** Every photo Curiosity took on a sol (NASA's raw-image service), wide views first.
 *  Thumbnails are skipped: they are smaller copies of photos already in the list. */
export function curiosityPhotos(sol) {
  if (photoCache.has(sol)) return photoCache.get(sol);
  const page = (n) => fetch(`https://mars.nasa.gov/api/v1/raw_image_items/?order=sol%20desc&per_page=${PHOTO_PAGE}` +
    `&page=${n}&condition_1=msl:mission&condition_2=${sol}:sol:in`).then((r) => r.json());
  const job = page(0).then(async (first) => {
    const pages = Math.min(PHOTO_PAGES, Math.ceil((first.total || 0) / PHOTO_PAGE));
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(i + 1)));
    const items = [first, ...rest].flatMap((d) => d.items || []);
    const rank = (it) => {
      const ins = it.instrument || '';
      let s = ins.startsWith('NAV') ? 0 : ins.startsWith('MAST') ? 1 : ins.includes('HAZ') ? 2 : 3;
      if (it.extended?.sample_type !== 'full') s += 4;
      return s;
    };
    return items
      .filter((it) => !it.is_thumbnail)
      .sort((a, b) => rank(a) - rank(b))
      .map((it) => ({ url: it.https_url || it.url, title: it.title || it.instrument }));
  });
  photoCache.set(sol, job);
  job.catch(() => photoCache.delete(sol));   // allow a retry if the network failed
  return job;
}

/** Popup content: heading, optional elevation and extra text, then a scrollable grid of photos. */
export function photoPopup(sol, elev, heading, extraHtml = '') {
  const el = document.createElement('div');
  el.className = 'wp-popup';
  const rawLink = `https://mars.nasa.gov/msl/multimedia/raw-images/?order=sol+desc&per_page=50&page=0&mission=msl&begin_sol=${sol}&end_sol=${sol}`;
  el.innerHTML = `<h4>${heading}</h4>
    ${elev != null ? `<p>Elevation ${Math.round(elev)} m</p>` : ''}
    ${extraHtml}
    <p class="photo-count">Loading Curiosity's photos from sol ${sol}…</p>
    <div class="photos"></div>
    <p>Photos by NASA/JPL-Caltech. <a href="${rawLink}" target="_blank" rel="noopener">Open sol ${sol} on NASA's raw-image site</a></p>`;
  const box = el.querySelector('.photos'), count = el.querySelector('.photo-count');
  curiosityPhotos(sol).then((photos) => {
    if (!photos.length) { count.textContent = `Curiosity sent back no photos for sol ${sol}.`; return; }
    count.textContent = photos.length === 1 ? 'One photo from this stop.' : `All ${photos.length} photos from this stop. Scroll for more.`;
    box.innerHTML = photos.map((ph) =>
      `<a href="${ph.url}" target="_blank" rel="noopener" title="${ph.title}, open full size"><img src="${ph.url}" alt="${ph.title}" loading="lazy"></a>`).join('');
  }).catch(() => { count.textContent = "Could not reach NASA's raw-image service. Check the internet connection."; });
  return el;
}

/** A photo you can page through: one big photo, previous and next buttons, and a counter.
 *  `onChange(i)` runs whenever another photo is shown (e.g. to update a caption). */
export function photoViewer(photos, onChange = () => {}) {
  const el = document.createElement('div');
  el.className = 'viewer';
  el.innerHTML = `<a target="_blank" rel="noopener" title="Open full size"><img alt=""></a>` +
    (photos.length > 1
      ? `<button type="button" class="prev" aria-label="Previous photo"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg></button>` +
        `<button type="button" class="next" aria-label="Next photo"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg></button>` +
        `<span class="count" aria-live="polite"></span>`
      : '');
  const a = el.querySelector('a'), img = el.querySelector('img'), count = el.querySelector('.count');
  let i = 0;
  const show = (n) => {
    i = (n + photos.length) % photos.length;
    a.href = img.src = photos[i].url;
    img.alt = photos[i].title;
    if (count) count.textContent = `${i + 1} of ${photos.length}`;
    new Image().src = photos[(i + 1) % photos.length].url;   // have the next one ready
    onChange(i);
  };
  el.querySelector('.prev')?.addEventListener('click', () => show(i - 1));
  el.querySelector('.next')?.addEventListener('click', () => show(i + 1));
  show(0);
  return el;
}

export const ORBITAL_VIEW_M = 400;
let orbitalImage = null;

/** A 4:3 close-up of the orbital photo centred on grid (r, c), with the astronaut marked. */
export async function orbitalCrop(r, c) {
  const { grid, config } = state;
  orbitalImage ??= new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = DATA + ((config.overlays || []).includes('photo.jpg') ? 'photo.jpg' : 'hillshade.png');
  });
  const im = await orbitalImage;
  const cv = document.createElement('canvas');
  cv.width = 480; cv.height = 360;
  const ctx = cv.getContext('2d');
  const pxPerCell = im.width / grid.W;
  const sw = ORBITAL_VIEW_M / grid.cell * pxPerCell, sh = sw * 0.75;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(im, (c + 0.5) * pxPerCell - sw / 2, (r + 0.5) * pxPerCell - sh / 2, sw, sh, 0, 0, cv.width, cv.height);
  ctx.beginPath();
  ctx.arc(cv.width / 2, cv.height / 2, 11, 0, Math.PI * 2);
  ctx.fillStyle = '#62d6e8'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'Orbital close-up of the astronaut\'s position');
  return cv;
}
