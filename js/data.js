/* Loading the files made by prepare_data.py (web/data/).
 * loadAll() downloads everything the first views need in parallel and reports progress in bytes,
 * so the briefing can show a progress bar and the app only starts once it all has arrived.
 * Images are downloaded only to fill the browser cache: Leaflet and three.js then load them instantly. */
import { DATA } from './state.js';
import { decodeGrid } from './routing/grid.js';

export async function getJSON(name, optional = false) {
  try {
    const res = await fetch(DATA + name);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (optional) { console.warn(`Optional file ${name} not loaded:`, err); return null; }
    throw new Error(`Could not load ${DATA}${name} (${err.message}). Run prepare_data.py and serve web/ with Live Server.`);
  }
}

// Pictures the map and 3D views show first. hillshade.png is left out: it is only loaded when
// the Relief base map is picked.
const PICTURES = ['mars_globe.jpg', 'gale_region.jpg', 'context_elev.png', 'context.jpg',
  'photo.jpg', 'slope.png', 'ground.png'];

/** Unzip gzip bytes with the browser's own DecompressionStream. Some servers already unzip
 *  .gz files on the way (Content-Encoding), so only unzip when the gzip signature is there. */
async function gunzip(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return blob.arrayBuffer();
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/**
 * Everything the app needs. Weather and Curiosity's route are optional.
 * onProgress({ loaded, total }) is called as bytes arrive (sizes from config.file_bytes).
 */
export async function loadAll(onProgress = () => {}) {
  const [config, gridHeader] = await Promise.all([getJSON('config.json'), getJSON('cost_grid.json')]);
  const sizes = config.file_bytes || {};
  // the data the app reads (true = the app cannot start without it), then the pictures
  const DATA_FILES = { [gridHeader.bin]: true, 'curiosity.geojson': false, 'weather.json': false };
  const names = [...Object.keys(DATA_FILES), ...PICTURES];
  const loaded = Object.fromEntries(names.map((n) => [n, 0]));
  const expected = Object.fromEntries(names.map((n) => [n, sizes[n] || 0]));
  const report = () => onProgress({
    loaded: names.reduce((s, n) => s + Math.min(loaded[n], expected[n]), 0),
    total: names.reduce((s, n) => s + expected[n], 0),
  });

  // Download one file chunk by chunk, counting bytes as they arrive. Returns the bytes, or null.
  const download = async (name, needed) => {
    try {
      const res = await fetch(DATA + name);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      // Without a size in config.json, Content-Length is right only when the server did not compress the file
      if (!expected[name] && !res.headers.get('Content-Encoding')) expected[name] = Number(res.headers.get('Content-Length')) || 0;
      const parts = [];
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded[name] += value.length;
        report();
      }
      expected[name] = loaded[name];   // finished: this file counts as complete
      report();
      return new Blob(parts);
    } catch (err) {
      expected[name] = loaded[name] = 0;   // drop it from the bar
      report();
      if (needed) throw new Error(`Could not load ${DATA}${name} (${err.message}). Run prepare_data.py and serve web/ with Live Server.`);
      console.warn(`Optional file ${name} not loaded:`, err);
      return null;
    }
  };
  const readJSON = async (name) => {
    const blob = await download(name, DATA_FILES[name]);
    return blob && JSON.parse(await blob.text());
  };
  const readGrid = async () => decodeGrid(gridHeader, await gunzip(await download(gridHeader.bin, true)));

  report();
  const [costGrid, curiosity, weather] = await Promise.all([
    readGrid(), readJSON('curiosity.geojson'), readJSON('weather.json'),
    ...PICTURES.map((n) => download(n, false)),
    // the 3D code and three.js (from the CDN) too, so the globe can open straight away
    import('../view3d.js').catch((err) => console.warn('3D view not preloaded:', err)),
  ]);
  return { config, costGrid, weather, curiosity };
}
